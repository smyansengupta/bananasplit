"use server";

import { redirect } from "next/navigation";

import { setActiveOrgCookie } from "@/lib/active-org-cookie";
import { requireOrgMembership } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export async function switchActiveOrg(orgSlug: string): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) {
    return;
  }

  // requireOrgMembership throws for a non-member; the switcher only ever
  // lists orgs the caller belongs to, so just no-op rather than surface it.
  try {
    await requireOrgMembership(org.id);
  } catch {
    return;
  }

  await setActiveOrgCookie(org.id);
  redirect(`/app/${org.slug}`);
}
