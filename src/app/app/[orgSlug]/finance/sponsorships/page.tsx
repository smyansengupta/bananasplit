import { SponsorshipsView } from "@/components/finance/sponsorships-view";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";

import { FinanceAccessGate } from "../finance-access-gate";
import { getActivePeriod, getOrgMembersForPicker, getSponsors, getSponsorships } from "../queries";

export default async function SponsorshipsPage({
  params,
}: PageProps<"/app/[orgSlug]/finance/sponsorships">) {
  const { orgSlug } = await params;
  const { organization: org, role } = await getOrgContextBySlug(orgSlug);
  // Not an owner or treasurer: who is, and what to do instead (never an error page).
  if (!can({ role }, "finance.manage")) {
    return <FinanceAccessGate orgId={org.id} orgSlug={orgSlug} role={role} />;
  }

  const { sponsors, sponsorships, activePeriod, memberships } = await withOrgTx(
    org.id,
    async ({ db }) => ({
      sponsors: await getSponsors(db, org.id),
      sponsorships: await getSponsorships(db, org.id),
      activePeriod: await getActivePeriod(db, org.id),
      memberships: await getOrgMembersForPicker(db, org.id),
    }),
  ).catch(handleAuthErrorInPage);
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
