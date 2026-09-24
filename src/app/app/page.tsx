import { redirect } from "next/navigation";

import { getActiveOrgId } from "@/lib/active-org-cookie";
import { requireUser } from "@/lib/auth/session";
import { withUserTx } from "@/server/db/context";

/** /app: the active org (cookie), else the first live org, else onboarding. */
export default async function AppIndexPage() {
  const user = await requireUser();
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
