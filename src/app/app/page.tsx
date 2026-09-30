import { redirect } from "next/navigation";

import { getActiveOrgId } from "@/lib/active-org-cookie";
import { requireUser } from "@/lib/auth/session";
import { withUserTx } from "@/server/db/context";
import { needsProfileSetup } from "@/server/onboarding/profile";

/**
 * /app: profile setup first if it isn't finished, then the active org
 * (cookie), else the first live org, else onboarding.
 */
export default async function AppIndexPage() {
  const user = await requireUser();
  if (await needsProfileSetup(user.id)) redirect("/onboarding");
  const activeOrgId = await getActiveOrgId();

  const slug = await withUserTx(user.id, async ({ db }) => {
    const live = { userId: user.id, organization: { deletedAt: null } };
    if (activeOrgId) {
      const active = await db.membership.findFirst({
        where: { ...live, organizationId: activeOrgId },
        select: { organization: { select: { slug: true } } },
      });
      if (active) return active.organization.slug;
    }
    const first = await db.membership.findFirst({
      where: live,
      orderBy: { joinedAt: "asc" },
      select: { organization: { select: { slug: true } } },
    });
    return first?.organization.slug ?? null;
  });

  redirect(slug ? `/app/${slug}` : "/onboarding");
}
