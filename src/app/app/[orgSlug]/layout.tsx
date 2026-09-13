import { notFound } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";
import { mockCurrentUser, mockOrgs } from "@/lib/shell-mock-data";

export default async function OrgLayout({ params, children }: LayoutProps<"/app/[orgSlug]">) {
  const { orgSlug } = await params;

  // Phase 1 replaces this with a real membership lookup (requireOrgMembership),
  // returning NotFound rather than Forbidden for org slugs the user can't reach.
  const org = mockOrgs.find((o) => o.slug === orgSlug);
  if (!org) notFound();

  return (
    <AppShell orgSlug={org.slug} orgs={mockOrgs} user={mockCurrentUser}>
      {children}
    </AppShell>
  );
}
