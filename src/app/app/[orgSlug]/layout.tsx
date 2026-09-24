import { notFound } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";
import { OrgBrand } from "@/components/theme/org-brand";
import { OrgThemeRoot } from "@/components/theme/org-theme-root";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { requireOrgMembership, type OrgContext } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { resolveTheme } from "@/lib/theme/resolve";
import { getOrgContextBySlug } from "@/server/db/context";

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

  // Theme (B8): the org's OrgTheme row comes with the per-request org
  // context (React cache(), shared with the pages below; no cross-request
  // cache), resolved and re-validated as strict hex before it is rendered.
  const { organization: themedOrg, theme: themeRow } = await getOrgContextBySlug(orgSlug);
  const theme = resolveTheme(themeRow);

  return (
    <OrgThemeRoot key={org.id} theme={theme}>
      <AppShell
        orgSlug={org.slug}
        orgId={org.id}
        orgs={orgs}
        user={{ name: ctx.user.name, email: ctx.user.email, image: null }}
        brand={
          <OrgBrand
            name={themedOrg.name}
            logo={themedOrg.logo}
            display={theme.logoDisplay}
            href={`/app/${org.slug}`}
            hideNameOnly
          />
        }
      >
        {children}
      </AppShell>
    </OrgThemeRoot>
  );
}
