import { CalendarRange, PiggyBank, Receipt } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { FinanceBoard } from "@/components/finance/finance-board";
import { NewTransactionButton } from "@/components/finance/transaction-table";
import { Button } from "@/components/ui/button";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { can } from "@/lib/auth/permissions";
import { visibleFinanceCards } from "@/lib/finance/dashboard-cards";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { resolveLayout } from "@/lib/finance/widgets";
import { loadSavedBoard } from "@/server/boards";

import { getCategoriesForPeriods, getDashboardData, getOrgPeriods } from "./queries";

/**
 * The finance dashboard (OWNER/TREASURER): adding money in or out is the
 * first button on the page, and below it each member's own board of
 * widgets. Everyone else lands on their reimbursements.
 */
export default async function FinancePage({ params }: PageProps<"/app/[orgSlug]/finance">) {
  const { orgSlug } = await params;
  const { organization: org, user, role, settings } = await getOrgContextBySlug(orgSlug);

  if (!can({ role }, "finance.manage")) {
    redirect(`/app/${orgSlug}/finance/my-reimbursements`);
  }

  const orgCards = visibleFinanceCards(settings?.financeDashboardCards);
  const { dashboard, saved, periods, categories } = await withOrgTx(org.id, async ({ db }) => {
    const periods = await getOrgPeriods(db, org.id);
    return {
      dashboard: await getDashboardData(db, org.id),
      saved: await loadSavedBoard(db, org.id, user.id, "finance"),
      periods,
      categories: await getCategoriesForPeriods(db, org.id, periods),
    };
  }).catch(handleAuthErrorInPage);

  if (!dashboard.period) {
    return (
      <EmptyState
        icon={CalendarRange}
        title="Start with a budget period"
        description="A period is your club's financial year or semester. Create one, add your budget categories, then record money in and out."
        action={
          <Button asChild>
            <Link href={`/app/${orgSlug}/finance/budget`}>
              <PiggyBank className="size-4" aria-hidden="true" />
              Create a budget period
            </Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-muted/40 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
        <div>
          <p className="font-medium">Record money in or out</p>
          <p className="text-muted-foreground text-sm">
            An expense, a sponsorship, dues or any other income. Receipts can be attached.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/app/${orgSlug}/finance/my-reimbursements`}>
              <Receipt className="size-4" aria-hidden="true" />
              Request a reimbursement
            </Link>
          </Button>
          <NewTransactionButton
            orgId={org.id}
            periods={periods.map((p) => ({ id: p.id, label: p.label }))}
            categories={categories.map((c) => ({
              id: c.id,
              name: c.name,
              budgetPeriodId: c.budgetPeriodId,
            }))}
            isFinance
            currentUserId={user.id}
          />
        </div>
      </div>

      {dashboard.unreconciledOver60DaysCount > 0 && (
        <p className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border p-3 text-sm">
          {dashboard.unreconciledOver60DaysCount} transaction(s) are unreconciled and over 60 days
          old.{" "}
          <Link href={`/app/${orgSlug}/finance/transactions?reconciled=no`} className="underline">
            Review them
          </Link>
        </p>
      )}

      <FinanceBoard
        orgId={org.id}
        orgSlug={orgSlug}
        data={dashboard}
        initialLayout={resolveLayout(saved, orgCards)}
        customized={saved !== null}
      />
    </div>
  );
}
