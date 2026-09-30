import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";
import type { OrgSummary } from "@/components/shell/types";
import { OrgBrand } from "@/components/theme/org-brand";
import { OrgThemeRoot } from "@/components/theme/org-theme-root";
import { CALLBACK_HEADER } from "@/lib/auth/callback-url";
import { requireUser } from "@/lib/auth/session";
import { orgLogoUrl } from "@/lib/org-logo";
import { applyPersonalTheme, parsePersonalTheme } from "@/lib/theme/personal";
import { resolveTheme } from "@/lib/theme/resolve";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { listPins } from "@/server/pins";
import { getShellUser, getViewerPrefs } from "@/server/profiles/queries";
import { findPendingDeletionOrg } from "@/server/settings/deletion";

import { OrgPendingDeletion } from "./org-pending-deletion";

/**
 * The org shell. getOrgContextBySlug resolves the slug (a retired slug from
 * a rename answers 307 to the current one; unknown slugs and non-members
 * get a 404) and loads the org switcher list in one transaction.
 *
 * An org scheduled for deletion resolves to nothing, so for its members the
 * URL shows the pending-deletion page instead (OWNERs can cancel there).
 *
 * The active-org cookie is not written here (cookies can only be set from a
 * Server Action or Route Handler): org creation, invite acceptance and the
 * org switcher set it.
 */

/**
 * getOrgContextBySlug answers a retired slug (a renamed org) with a 307 to
 * /app/{current}. Keep the rest of the path, so deep links from emails and
 * bookmarks survive a rename: /app/old/tasks/1 -> /app/new/tasks/1.
 */
async function deepRedirectTarget(error: unknown, orgSlug: string): Promise<string | null> {
  const digest = (error as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT;")) return null;
  const target = digest.split(";")[2];
  if (!target || !/^\/app\/[a-z0-9-]+$/.test(target)) return null;
  // The header carries path + query (it doubles as the sign-in callbackUrl);
  // the redirect target only needs the path.
  const pathname = ((await headers()).get(CALLBACK_HEADER) ?? "").split("?")[0];
  const prefix = `/app/${orgSlug}`;
  if (!pathname.startsWith(`${prefix}/`)) return null;
  const rest = pathname.slice(prefix.length);
  return /^[A-Za-z0-9/_.~-]*$/.test(rest) && !rest.includes("..") ? `${target}${rest}` : null;
}

function isNotFound(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404");
}

export default async function OrgLayout({ params, children }: LayoutProps<"/app/[orgSlug]">) {
  const { orgSlug } = await params;
  const user = await requireUser();

  let ctx: Awaited<ReturnType<typeof getOrgContextBySlug>>;
  try {
    ctx = await getOrgContextBySlug(orgSlug);
  } catch (error) {
    // Only on a 404 (the common path costs nothing extra): is it one of
    // the caller's orgs that is scheduled for deletion?
    const deep = await deepRedirectTarget(error, orgSlug);
    if (deep) redirect(deep);
    if (isNotFound(error)) {
      const pending = await findPendingDeletionOrg(user.id, orgSlug);
      if (pending) return <OrgPendingDeletion org={pending} />;
    }
    throw error;
  }
  const orgs: OrgSummary[] = [
    ...ctx.memberships.map((m) => ({
      slug: m.slug,
      name: m.name,
      logoUrl: orgLogoUrl(m.logo, 64),
    })),
    ...ctx.pendingDeletion.map((m) => ({
      slug: m.slug,
      name: m.name,
      logoUrl: orgLogoUrl(m.logo, 64),
      pendingDeletion: true,
    })),
  ];

  // Name and picture from the database, not the session token (Profiles).
  const shellUser = await getShellUser(ctx.user.id, ctx.user.email);
  // Someone who joined through an emailed invite before finishing profile
  // setup finishes it first (the flowchart's "Profile complete?").
  const prefs = await getViewerPrefs(ctx.user.id);
  if (!prefs.onboardedAt) redirect("/onboarding");
  // The org's OrgTheme row rides along with the per-request org context
  // (React cache()), resolved and re-validated as strict hex before render;
  // the member's personal theme (profile setup A4) goes on top of it.
  const theme = applyPersonalTheme(resolveTheme(ctx.theme), parsePersonalTheme(prefs.themePreference));
  const pins = await withOrgTx(ctx.organization.id, ({ db }) =>
    listPins(db, ctx.organization.id, ctx.organization.slug, ctx.user.id),
  );

  return (
    <OrgThemeRoot key={ctx.organization.id} theme={theme}>
      <AppShell
        orgSlug={ctx.organization.slug}
        orgId={ctx.organization.id}
        orgs={orgs}
        user={shellUser}
        pins={pins}
        brand={
          <OrgBrand
            name={ctx.organization.name}
            logo={ctx.organization.logo}
            display={theme.logoDisplay}
            href={`/app/${ctx.organization.slug}`}
            hideNameOnly
          />
        }
      >
        {children}
      </AppShell>
    </OrgThemeRoot>
  );
}
