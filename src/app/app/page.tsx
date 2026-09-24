import { redirect } from "next/navigation";

import { getActiveOrgId } from "@/lib/active-org-cookie";
import { requireUser } from "@/lib/auth/session";
import { withUserTx } from "@/server/db/context";

/**
 * Bare /app: the active org from the signed cookie if the user still
 * belongs to it, otherwise their first org, otherwise onboarding. Reads the
 * user's own memberships in withUserTx (app_user, no org context).
 */
export default async function AppIndexPage() {
  const user = await requireUser();
  const activeOrgId = await getActiveOrgId();

  const slug = await withUserTx(user.id, async ({ db }) => {
    const live = { userId: user.id, organization: { deletedAt: null } };
    const active = activeOrgId
      ? await db.membership.findFirst({
          where: { ...live, organizationId: activeOrgId },
          select: { organization: { select: { slug: true } } },
        })
      : null;
    const membership =
      active ??
      (await db.membership.findFirst({
        where: live,
        select: { organization: { select: { slug: true } } },
      }));
    return membership?.organization.slug ?? null;
  });

  redirect(slug ? `/app/${slug}` : "/onboarding");
}
