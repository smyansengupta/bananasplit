import { notFound } from "next/navigation";

import { SponsorshipsView } from "@/components/finance/sponsorships-view";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { requireFinanceAccess } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

import { getActivePeriod, getOrgMembersForPicker, getSponsors, getSponsorships } from "../queries";

export default async function SponsorshipsPage({
  params,
}: PageProps<"/app/[orgSlug]/finance/sponsorships">) {
  const { orgSlug } = await params;

  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) {
    notFound();
  }

  try {
    await requireFinanceAccess(org.id);
  } catch (error) {
    handleAuthErrorInPage(error);
  }

  const [sponsors, sponsorships, activePeriod, memberships] = await Promise.all([
    getSponsors(org.id),
    getSponsorships(org.id),
    getActivePeriod(org.id),
    getOrgMembersForPicker(org.id),
  ]);
  const members = memberships.map((m) => ({
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
  }));

  return (
    <SponsorshipsView
      orgId={org.id}
      sponsors={sponsors}
      sponsorships={sponsorships}
      periodId={activePeriod?.id ?? null}
      members={members}
    />
  );
}
