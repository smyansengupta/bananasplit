import { redirect } from "next/navigation";

import { getActiveOrgId } from "@/lib/active-org-cookie";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export default async function AppIndexPage() {
  const user = await requireUser();

  const activeOrgId = await getActiveOrgId();
  if (activeOrgId) {
    const membership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId: user.id, organizationId: activeOrgId } },
      include: { organization: true },
    });
    if (membership) {
      redirect(`/app/${membership.organization.slug}`);
    }
  }

  const firstMembership = await prisma.membership.findFirst({
    where: { userId: user.id },
    include: { organization: true },
  });
  if (firstMembership) {
    redirect(`/app/${firstMembership.organization.slug}`);
  }

  redirect("/onboarding");
}
