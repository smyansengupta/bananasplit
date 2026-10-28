import "server-only";

import type { OrgKind, OrgPlan } from "@/generated/prisma/client";
import { appUrl } from "@/lib/app-url";
import { NotFoundError } from "@/lib/auth/errors";
import { can } from "@/lib/auth/permissions";
import type { PlanFeature } from "@/lib/billing/features";
import { spaceIncludes } from "@/lib/billing/space";
import { sectionLabel, type SectionId } from "@/lib/nav/sidebar";
import { effectiveTimezone } from "@/lib/tasks/dates";
import { withConnectorOrgTx, type OrgContext } from "@/server/db/context";
import { AppError } from "@/server/db/errors";
import { hiddenSections } from "@/server/search/viewer";

import type { ConnectorSession } from "./shared";

/**
 * Every read tool opens its space here: withConnectorOrgTx (the grant's
 * scope, membership, the club switch, the plan's `feature`), reads allowed
 * while a club is paused, then the space as the tool needs it. A section
 * the club hid in Settings › Sidebar is refused to members, as search
 * leaves it out of theirs; owners and admins still read it.
 */

/** A section the club hid from its members (Settings › Sidebar). */
export class SectionHiddenError extends AppError {
  constructor(spaceName: string, sectionName: string) {
    super(
      `${spaceName} has hidden ${sectionName} from members, so it can't be read here.`,
      403,
      "CONNECTOR_SECTION_HIDDEN",
    );
    this.name = "SectionHiddenError";
  }
}

export interface ToolSpace {
  id: string;
  /** The club's name, or "Personal". */
  name: string;
  kind: "personal" | "club";
  slug: string;
  /** The member's zone (their own, else the club's), for times. */
  zone: string;
  /** The club's zone (all-day events and due dates are its days). */
  orgZone: string;
  /** Owners and admins: hidden sections stay open to them. */
  admin: boolean;
  /** An absolute link into the space: url("/tasks/abc"). */
  url(path?: string): string;
  /** The plan includes `feature` (a paused club still reads everything). */
  includes(feature: PlanFeature): boolean;
  /** Whether this member may read `section` (it isn't hidden, or they're an admin). */
  opens(section: SectionId): boolean;
  /** Throws SectionHiddenError unless `opens(section)`. */
  requireSection(section: SectionId): void;
}

export interface SpaceOptions {
  /** The tool's plan feature (src/lib/billing/features.ts). */
  feature?: PlanFeature;
  /** The sidebar section the tool reads. */
  section?: SectionId;
}

/** The space for a tool, read in its transaction. */
export async function loadToolSpace(ctx: OrgContext): Promise<ToolSpace> {
  const org = await ctx.db.organization.findUnique({
    where: { id: ctx.organizationId },
    select: {
      name: true,
      slug: true,
      kind: true,
      plan: true,
      trialEndsAt: true,
      timezone: true,
      settings: { select: { sidebar: true } },
    },
  });
  if (!org) throw new NotFoundError();
  const user = await ctx.db.user.findUnique({
    where: { id: ctx.userId },
    select: { timezone: true },
  });
  return toolSpace(ctx, org, user?.timezone ?? null);
}

function toolSpace(
  ctx: Pick<OrgContext, "organizationId" | "role">,
  org: {
    name: string;
    slug: string;
    kind: OrgKind;
    plan: OrgPlan;
    trialEndsAt: Date | null;
    timezone: string;
    settings: { sidebar: unknown } | null;
  },
  userZone: string | null,
): ToolSpace {
  const personal = org.kind === "PERSONAL";
  const name = personal ? "Personal" : org.name;
  const admin = can({ role: ctx.role }, "settings.view");
  const hidden = hiddenSections(org.settings?.sidebar);
  const orgZone = effectiveTimezone(null, org);
  const opens = (section: SectionId) => admin || !hidden.has(section);
  return {
    id: ctx.organizationId,
    name,
    kind: personal ? "personal" : "club",
    slug: org.slug,
    zone: effectiveTimezone({ timezone: userZone }, org),
    orgZone,
    admin,
    url: (path = "") => appUrl(`/app/${org.slug}${path}`),
    includes: (feature) => spaceIncludes(org, feature),
    opens,
    requireSection(section) {
      if (!opens(section)) {
        throw new SectionHiddenError(name, sectionLabel(org.settings?.sidebar, section));
      }
    },
  };
}

/**
 * Runs `fn` as the member in `spaceId` for a read tool: one transaction
 * under RLS, refused before `fn` runs when the wrapper or the space says no.
 */
export function inSpace<T>(
  session: ConnectorSession,
  spaceId: string,
  options: SpaceOptions,
  fn: (ctx: OrgContext, space: ToolSpace) => Promise<T>,
): Promise<T> {
  return withConnectorOrgTx(
    session.connector,
    session.grant,
    spaceId,
    { feature: options.feature },
    async (ctx) => {
      const space = await loadToolSpace(ctx);
      if (options.section) space.requireSection(options.section);
      return fn(ctx, space);
    },
  );
}
