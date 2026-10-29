import { ReimbursementStats } from "@/components/finance/reimbursement-stats";
import { TransactionTable } from "@/components/finance/transaction-table";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { can } from "@/lib/auth/permissions";
import { formatCents } from "@/lib/finance/money";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { planGate } from "@/server/billing/plan-gate";

import { FinanceAccessGate } from "../finance-access-gate";
import {
  getCategoriesForPeriods,
  getMoneyOwedToUser,
  getMyReimbursements,
  getOrgPeriods,
} from "../queries";

export default async function MyReimbursementsPage({
  params,
}: PageProps<"/app/[orgSlug]/finance/my-reimbursements">) {
  const { orgSlug } = await params;
  const planLock = await planGate(orgSlug, "finance");
  if (planLock) return planLock;
  const { organization: org, user, role } = await getOrgContextBySlug(orgSlug);
  const isFinance = can({ role }, "finance.manage");

  const { transactions, periods, categories, owedCents } = await withOrgTx(
    org.id,
    async ({ db }) => {
      const transactions = await getMyReimbursements(db, org.id, user.id);
      const periods = await getOrgPeriods(db, org.id);
      const categories = await getCategoriesForPeriods(db, org.id, periods);
      const owedCents = await getMoneyOwedToUser(db, org.id, user.id);
      return { transactions, periods, categories, owedCents };
    },
  ).catch(handleAuthErrorInPage);

  const pending = transactions.filter(
    (t) => !t.voidedAt && (t.status === "SUBMITTED" || t.status === "APPROVED"),
  ).length;

  // Request a reimbursement is the Finance header's button on this page.
  return (
    <div className="space-y-6">
      {!isFinance && <FinanceAccessGate orgId={org.id} orgSlug={orgSlug} role={role} compact />}
      <ReimbursementStats
        owed={formatCents(owedCents)}
        requests={transactions.length}
        waiting={pending}
      />
      <p className="text-muted-foreground -mt-2 max-w-prose text-sm">
        Your own expense submissions and where each one is: hatched while it waits for approval or
        payment, green once you&apos;re paid back.
      </p>
      <TransactionTable
        orgId={org.id}
        transactions={transactions}
        periods={periods}
        categories={categories}
        isFinance={isFinance}
        currentUserId={user.id}
        emptyDescription="Nothing yet. Use “Request a reimbursement” to be paid back for something you bought for the organization."
      />
    </div>
  );
}
