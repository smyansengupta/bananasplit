"use server";

import { redirect } from "next/navigation";

import { setActiveOrgCookie } from "@/lib/active-org-cookie";
import { requireUser } from "@/lib/auth/session";
import { withUserTx } from "@/server/db/context";

/**
 * The org switcher: remembers the chosen org for the next bare /app visit
 * and navigates there. app_user's Organization policy shows only the
 * caller's own orgs, so a slug the caller does not belong to finds nothing
 * and the action is a no-op.
 */
export async function switchActiveOrg(orgSlug: string): Promise<void> {
  const user = await requireUser();
  const org = await withUserTx(user.id, ({ db }) =>
    db.organization.findFirst({
      where: { slug: orgSlug, memberships: { some: { userId: user.id } } },
      select: { id: true, slug: true },
    }),
  );
  if (!org) return;

  await setActiveOrgCookie(org.id);
  redirect(`/app/${org.slug}`);
}
