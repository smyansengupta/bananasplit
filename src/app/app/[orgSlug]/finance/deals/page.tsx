import { DealsView } from "@/components/finance/deals-view";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { planGate } from "@/server/billing/plan-gate";
import { financeCrmLinks } from "@/server/crm/outside-links";

import { FinanceAccessGate } from "../finance-access-gate";
import { getActivePeriod, getOrgMembersForPicker, getSponsors, getSponsorships } from "../queries";

/** Finance › Deals: money a partner commits, from first ask to received (Sponsorship rows). */
export default async function DealsPage({
  params,
}: PageProps<"/app/[orgSlug]/finance/deals">) {
  const { orgSlug } = await params;
  const planLock = await planGate(orgSlug, "sponsorships");
  if (planLock) return planLock;
  const { organization: org, role, user } = await getOrgContextBySlug(orgSlug);
  // Not an owner, admin or treasurer: who is, and what to do instead (never an error page).
  if (!can({ role }, "finance.manage")) {
    return <FinanceAccessGate orgId={org.id} orgSlug={orgSlug} role={role} />;
  }

  const { sponsors, sponsorships, activePeriod, memberships, crm } = await withOrgTx(
    org.id,
    async (ctx) => {
      const { db } = ctx;
      const sponsors = await getSponsors(db, org.id);
      const sponsorships = await getSponsorships(db, org.id);
      return {
        sponsors,
        sponsorships,
        activePeriod: await getActivePeriod(db, org.id),
        memberships: await getOrgMembersForPicker(db, org.id),
        // The same deal and partner in the CRM, when it's there for this member.
        crm: await financeCrmLinks(ctx, orgSlug, {
          sponsors,
          sponsorshipIds: sponsorships.map((s) => s.id),
        }),
      };
    },
  ).catch(handleAuthErrorInPage);
  const members = memberships.map((m) => ({
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
  }));

  return (
    <DealsView
      orgId={org.id}
      sponsors={sponsors}
      sponsorships={sponsorships}
      periodId={activePeriod?.id ?? null}
      members={members}
      currentUserId={user.id}
      budgetHref={`/app/${orgSlug}/finance/budget`}
      crm={crm}
    />
  );
}
