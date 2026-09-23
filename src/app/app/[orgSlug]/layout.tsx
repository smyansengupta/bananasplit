import { notFound } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { requireOrgMembership, type OrgContext } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { getShellUser } from "@/server/profiles/queries";

export default async function OrgLayout({ params, children }: LayoutProps<"/app/[orgSlug]">) {
  const { orgSlug } = await params;

  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) {
    notFound();
  }

  let ctx: OrgContext;
  try {
    ctx = await requireOrgMembership(org.id);
  } catch (error) {
    handleAuthErrorInPage(error);
  }

  // Not persisted here — cookies can only be written from a Server Action or
  // Route Handler, not while rendering. The active-org cookie is set at the
  // explicit switch points instead: org creation, invite acceptance, and the
  // org switcher (see switchActiveOrg in src/app/app/actions.ts).

  const memberships = await prisma.membership.findMany({
    where: { userId: ctx.user.id },
    include: { organization: true },
    orderBy: { organization: { name: "asc" } },
  });
  const orgs = memberships.map((m) => ({ slug: m.organization.slug, name: m.organization.name }));
  // Name and picture from the database, not the session token (Profiles).
  const shellUser = await getShellUser(ctx.user.id, ctx.user.email);

  return (
    <AppShell orgSlug={org.slug} orgId={org.id} orgs={orgs} user={shellUser}>
      {children}
    </AppShell>
  );
}
