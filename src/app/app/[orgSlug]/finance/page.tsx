import { TriangleAlert } from "@/components/icons";
import Link from "next/link";
import { redirect } from "next/navigation";

import { FinanceBoard } from "@/components/finance/finance-board";
import { Button } from "@/components/ui/button";
import { FinanceSetupBanner } from "@/components/finance/setup/setup-banner";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { can } from "@/lib/auth/permissions";
import { visibleFinanceCards } from "@/lib/finance/dashboard-cards";
import { coreSetupDone } from "@/lib/finance/setup";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { resolveLayout } from "@/lib/finance/widgets";
import { loadSavedBoard } from "@/server/boards";
import { loadSetupState } from "@/server/finance/setup";
import { planGate } from "@/server/billing/plan-gate";

import { getDashboardData } from "./queries";

/**
 * The finance dashboard (OWNER/TREASURER): each member's own board of
 * widgets, under the header's Add transaction. It never dead-ends: until the
 * budget basics are in place the setup guide's banner sits on top (Finance ›
 * Set up), the board shows empty widgets, and the first transaction sets up
 * this school year by itself. Everyone else lands on their reimbursements.
 */
export default async function FinancePage({ params }: PageProps<"/app/[orgSlug]/finance">) {
  const { orgSlug } = await params;
  const planLock = await planGate(orgSlug, "finance");
  if (planLock) return planLock;
  const { organization: org, user, role, settings } = await getOrgContextBySlug(orgSlug);

  if (!can({ role }, "finance.manage")) {
    redirect(`/app/${orgSlug}/finance/my-reimbursements`);
  }

  const orgCards = visibleFinanceCards(settings?.financeDashboardCards);
  const { dashboard, saved, setup } = await withOrgTx(org.id, async ({ db }) => ({
    dashboard: await getDashboardData(db, org.id),
    saved: await loadSavedBoard(db, org.id, user.id, "finance"),
    setup: await loadSetupState(db, org.id, user.id),
  })).catch(handleAuthErrorInPage);

  return (
    <div className="space-y-6">
      {!coreSetupDone(setup) && (
        <FinanceSetupBanner orgId={org.id} orgSlug={orgSlug} state={setup} />
      )}

      {dashboard.unreconciledOver60DaysCount > 0 && (
        <div className="bg-tint-danger text-tint-danger-foreground rounded-tile flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 pr-2.5 pl-4 text-sm">
          <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1">
            {dashboard.unreconciledOver60DaysCount === 1
              ? "1 transaction is unreconciled and over 60 days old."
              : `${dashboard.unreconciledOver60DaysCount} transactions are unreconciled and over 60 days old.`}
          </p>
          <Button asChild size="sm" variant="outline" className="border-current/30">
            <Link href={`/app/${orgSlug}/finance/transactions?reconciled=no`}>Review them</Link>
          </Button>
        </div>
      )}

      <FinanceBoard
        orgId={org.id}
        orgSlug={orgSlug}
        data={dashboard}
        setup={setup}
        initialLayout={resolveLayout(saved, orgCards)}
        customized={saved !== null}
      />
    </div>
  );
}
