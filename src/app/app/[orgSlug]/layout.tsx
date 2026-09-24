import { AppShell } from "@/components/shell/app-shell";
import type { OrgSummary } from "@/components/shell/types";
import { requireUser } from "@/lib/auth/session";
import { orgLogoUrl } from "@/lib/org-logo";
import { getOrgContextBySlug } from "@/server/db/context";
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

  return (
    <AppShell
      orgSlug={ctx.organization.slug}
      orgId={ctx.organization.id}
      orgs={orgs}
      user={{ name: ctx.user.name, email: ctx.user.email, image: null }}
    >
      {children}
    </AppShell>
  );
}
