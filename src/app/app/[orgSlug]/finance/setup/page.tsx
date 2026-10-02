import { FinanceSetup } from "@/components/finance/setup/finance-setup";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { can } from "@/lib/auth/permissions";
import { safeTimeZone, zonedDateKey } from "@/lib/calendar/dates";
import { visibleFinanceCards } from "@/lib/finance/dashboard-cards";
import { toDateValue } from "@/lib/finance/periods";
import { resolveLayout } from "@/lib/finance/widgets";
import { loadSavedBoard } from "@/server/boards";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { loadSetupState } from "@/server/finance/setup";

import { FinanceAccessGate } from "../finance-access-gate";
import { getCategoriesForPeriods, getOrgMembersForPicker, getOrgPeriods } from "../queries";

/** Finance › Set up: the guided setup (owners and treasurers). */
export default async function FinanceSetupPage({ params }: PageProps<"/app/[orgSlug]/finance/setup">) {
  const { orgSlug } = await params;
  const { organization: org, user, role, settings } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "finance.manage")) {
    return <FinanceAccessGate orgId={org.id} orgSlug={orgSlug} role={role} />;
  }

  const data = await withOrgTx(org.id, async ({ db }) => {
    const state = await loadSetupState(db, org.id, user.id);
    const periods = await getOrgPeriods(db, org.id);
    const categories = await getCategoriesForPeriods(db, org.id, periods);
    const members = await getOrgMembersForPicker(db, org.id);
    const saved = await loadSavedBoard(db, org.id, user.id, "finance");
    return { state, periods, categories, members, saved };
  }).catch(handleAuthErrorInPage);

  const active = data.state.period;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Set up your club&apos;s finances</h2>
        <p className="text-muted-foreground text-sm">
          About five minutes. Every step saves as you go, so you can stop and come back.
        </p>
      </div>
      <FinanceSetup
        orgId={org.id}
        orgSlug={orgSlug}
        today={zonedDateKey(new Date(), safeTimeZone(org.timezone))}
        state={data.state}
        lines={data.categories
          .filter((c) => c.budgetPeriodId === active?.id)
          .map((c) => ({ id: c.id, name: c.name, allocatedCents: c.allocatedCents }))}
        periods={data.periods.map((p) => ({
          id: p.id,
          label: p.label,
          startsOn: toDateValue(p.startsOn),
          endsOn: toDateValue(p.endsOn),
          isActive: p.isActive,
        }))}
        allCategories={data.categories.map((c) => ({ name: c.name, budgetPeriodId: c.budgetPeriodId }))}
        members={data.members.map((m) => ({
          userId: m.userId,
          name: m.user.name?.trim() || m.user.email,
          role: m.role,
        }))}
        canAppoint={can({ role }, "members.changeRole")}
        currentUserId={user.id}
        board={resolveLayout(data.saved, visibleFinanceCards(settings?.financeDashboardCards))}
      />
    </div>
  );
}
