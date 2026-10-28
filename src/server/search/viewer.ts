import type { Role } from "@/generated/prisma/client";
import { resolveSidebar, type SectionId } from "@/lib/nav/sidebar";
import { isValidTimeZone } from "@/lib/timezones";
import type { TxClient } from "@/server/db/context";

import type { SearchViewer } from "./workspace";

/**
 * Who is searching (src/server/search/workspace.ts), read in the caller's
 * transaction as that member: the space's slug and zones, the sections it
 * hid and its published org chart. Shared by the ⌘K palette's action and
 * the AI connectors' search tool, so both search the same way.
 */

/** Sections the org turned off in Settings › Sidebar (OrgSettings.sidebar). */
export function hiddenSections(sidebar: unknown): Set<SectionId> {
  return new Set(
    resolveSidebar(sidebar)
      .flatMap((g) => g.items)
      .filter((i) => i.hidden)
      .map((i) => i.id),
  );
}

/** The member as searchWorkspace needs them, or null when the space is gone. */
export async function loadSearchViewer(
  db: TxClient,
  member: { organizationId: string; userId: string; role: Role },
): Promise<SearchViewer | null> {
  const org = await db.organization.findUnique({
    where: { id: member.organizationId },
    select: {
      slug: true,
      kind: true,
      timezone: true,
      activeOrgChartVersionId: true,
      settings: { select: { sidebar: true } },
    },
  });
  if (!org) return null;
  const user = await db.user.findUnique({
    where: { id: member.userId },
    select: { timezone: true },
  });
  const orgZone = isValidTimeZone(org.timezone) ? org.timezone : "UTC";
  const viewerZone = user?.timezone && isValidTimeZone(user.timezone) ? user.timezone : orgZone;
  return {
    orgId: member.organizationId,
    orgSlug: org.slug,
    userId: member.userId,
    role: member.role,
    zones: { viewer: viewerZone, org: orgZone },
    hiddenSections: hiddenSections(org.settings?.sidebar),
    orgChartVersionId: org.activeOrgChartVersionId,
    personal: org.kind === "PERSONAL",
  };
}
