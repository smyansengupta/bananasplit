import { unstable_cache } from "next/cache";

import { tags } from "@/server/cache/tags";
import { withSystemOrgTx } from "@/server/db/context";

import { resolveTheme, type ResolvedTheme } from "./resolve";

/**
 * Server-only theme reads for the org-owned PUBLIC pages (/poll/[pollId],
 * /invite/[token]), where the visitor is usually not a member, so the
 * member path (RLS on app_user) cannot read the org's theme.
 *
 * getOrgBranding(orgId) is a cached loader under the plan-wide contract:
 * unstable_cache tagged tags.theme(orgId) and invalidated by the theme save
 * and reset (invalidate([tags.theme(orgId)])). It opens its own
 * withSystemOrgTx with the explicit orgId and returns only what a public
 * page may show: the org's name, logo and theme. The in-app layout does not
 * use it: it reads the theme per request in getOrgContextBySlug.
 *
 * The org-id lookups use the 0B definer functions granted to app_service
 * (app.poll_org_id, app.invitation_by_token_hash) and return null for
 * anything unknown; they are not cached (one indexed lookup each).
 */

export interface OrgBranding {
  organizationId: string;
  name: string;
  logo: unknown;
  theme: {
    preset: string;
    mode: string;
    lockMode: boolean;
    logoDisplay: string;
    light: unknown;
    dark: unknown;
  } | null;
}

async function loadOrgBranding(orgId: string): Promise<OrgBranding | null> {
  return withSystemOrgTx(orgId, async ({ db }) => {
    const org = await db.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, logo: true, deletedAt: true },
    });
    if (!org || org.deletedAt) return null;
    const theme = await db.orgTheme.findUnique({
      where: { organizationId: orgId },
      select: {
        preset: true,
        mode: true,
        lockMode: true,
        logoDisplay: true,
        light: true,
        dark: true,
      },
    });
    return { organizationId: org.id, name: org.name, logo: org.logo, theme };
  });
}

/** Five minutes as a backstop for changes that do not invalidate (a logo or name edit). */
const BRANDING_REVALIDATE_SECONDS = 300;

export function getOrgBranding(orgId: string): Promise<OrgBranding | null> {
  return unstable_cache(() => loadOrgBranding(orgId), ["org-branding", orgId], {
    tags: [tags.theme(orgId)],
    revalidate: BRANDING_REVALIDATE_SECONDS,
  })();
}

export interface PublicOrgTheme {
  organizationId: string;
  name: string;
  logo: unknown;
  theme: ResolvedTheme;
}

/** The branding plus the resolved theme, or null for an unknown org. */
export async function getPublicOrgTheme(orgId: string | null): Promise<PublicOrgTheme | null> {
  if (!orgId) return null;
  const branding = await getOrgBranding(orgId);
  if (!branding) return null;
  return {
    organizationId: branding.organizationId,
    name: branding.name,
    logo: branding.logo,
    theme: resolveTheme(branding.theme),
  };
}

/** The org that owns an availability poll, or null. */
export async function orgIdForPoll(pollId: string): Promise<string | null> {
  if (!pollId || pollId.length > 64) return null;
  return withSystemOrgTx(null, async ({ db }) => {
    const rows = await db.$queryRaw<
      { id: string | null }[]
    >`SELECT app.poll_org_id(${pollId}) AS id`;
    return rows[0]?.id ?? null;
  });
}

/** The org behind an invite link (by the hash of its raw token), or null. */
export async function orgIdForInviteTokenHash(tokenHash: string): Promise<string | null> {
  if (!/^[0-9a-f]{64}$/.test(tokenHash)) return null;
  return withSystemOrgTx(null, async ({ db }) => {
    const rows = await db.$queryRaw<{ organizationId: string }[]>`
      SELECT "organizationId" FROM app.invitation_by_token_hash(${tokenHash})`;
    return rows[0]?.organizationId ?? null;
  });
}
