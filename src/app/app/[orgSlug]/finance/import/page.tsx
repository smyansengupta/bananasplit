import { FinanceImport } from "@/components/finance/import/finance-import";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { can } from "@/lib/auth/permissions";
import { safeTimeZone, zonedDateKey } from "@/lib/calendar/dates";
import { toDateValue } from "@/lib/finance/periods";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { planGate } from "@/server/billing/plan-gate";

import { FinanceAccessGate } from "../finance-access-gate";
import { getCategoriesForPeriods, getOrgPeriods } from "../queries";

/** Finance › Import: past spreadsheets, bank exports, PDFs and photos into the ledger (owners, admins and treasurers). */
export default async function FinanceImportPage({
  params,
}: PageProps<"/app/[orgSlug]/finance/import">) {
  const { orgSlug } = await params;
  const planLock = await planGate(orgSlug, "finance");
  if (planLock) return planLock;
  const { organization: org, role } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "finance.manage")) {
    return <FinanceAccessGate orgId={org.id} orgSlug={orgSlug} role={role} />;
  }

  const { periods, categories } = await withOrgTx(org.id, async ({ db }) => {
    const periods = await getOrgPeriods(db, org.id);
    return { periods, categories: await getCategoriesForPeriods(db, org.id, periods) };
  }).catch(handleAuthErrorInPage);

  return (
    <div className="space-y-4.5">
      <div className="space-y-1">
        <h2 className="heading text-lg">Import past records</h2>
        <p className="text-muted-foreground max-w-2xl text-sm">
          Bring in last year&apos;s spreadsheet, a bank, card or Venmo export, receipts or an old
          budget. Your organization&apos;s AI model can read messy sheets, PDFs and photos; you
          check every row before it&apos;s saved.
        </p>
      </div>
      <FinanceImport
        orgId={org.id}
        orgSlug={orgSlug}
        today={zonedDateKey(new Date(), safeTimeZone(org.timezone))}
        periods={periods.map((p) => ({
          id: p.id,
          label: p.label,
          startsOn: toDateValue(p.startsOn),
          endsOn: toDateValue(p.endsOn),
          isActive: p.isActive,
        }))}
        categories={categories.map((c) => ({ name: c.name, budgetPeriodId: c.budgetPeriodId }))}
      />
    </div>
  );
}
