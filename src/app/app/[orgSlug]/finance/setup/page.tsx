import { QuickFinanceSetup } from "@/components/finance/setup/quick-setup";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { can } from "@/lib/auth/permissions";
import { safeTimeZone, zonedDateKey } from "@/lib/calendar/dates";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { loadSetupState } from "@/server/finance/setup";
import { planGate } from "@/server/billing/plan-gate";

import { FinanceAccessGate } from "../finance-access-gate";
import { getCategoriesForPeriods, getOrgPeriods } from "../queries";

/** Finance › Set up: one screen, one Save (owners, admins and treasurers). */
export default async function FinanceSetupPage({
  params,
}: PageProps<"/app/[orgSlug]/finance/setup">) {
  const { orgSlug } = await params;
  const planLock = await planGate(orgSlug, "finance");
  if (planLock) return planLock;
  const { organization: org, user, role } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "finance.manage")) {
    return <FinanceAccessGate orgId={org.id} orgSlug={orgSlug} role={role} />;
  }

  const data = await withOrgTx(org.id, async ({ db }) => {
    const state = await loadSetupState(db, org.id, user.id);
    const periods = await getOrgPeriods(db, org.id);
    const categories = await getCategoriesForPeriods(db, org.id, periods);
    return { state, categories };
  }).catch(handleAuthErrorInPage);

  const active = data.state.period;
  return (
    <div className="space-y-4.5">
      <h2 className="heading text-lg">Set up finance</h2>
      <QuickFinanceSetup
        orgId={org.id}
        orgSlug={orgSlug}
        today={zonedDateKey(new Date(), safeTimeZone(org.timezone))}
        state={data.state}
        lines={data.categories
          .filter((c) => c.budgetPeriodId === active?.id)
          .map((c) => ({ id: c.id, name: c.name, allocatedCents: c.allocatedCents }))}
      />
    </div>
  );
}
