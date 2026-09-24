import { NewTransactionButton, TransactionTable } from "@/components/finance/transaction-table";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";

import { getCategoriesForPeriods, getMyReimbursements, getOrgPeriods } from "../queries";

export default async function MyReimbursementsPage({
  params,
}: PageProps<"/app/[orgSlug]/finance/my-reimbursements">) {
  const { orgSlug } = await params;
  const { organization: org, user, role } = await getOrgContextBySlug(orgSlug);
  const isFinance = can({ role }, "finance.manage");

  const { transactions, periods, categories } = await withOrgTx(org.id, async ({ db }) => {
    const transactions = await getMyReimbursements(db, org.id, user.id);
    const periods = await getOrgPeriods(db, org.id);
    const categories = await getCategoriesForPeriods(db, org.id, periods);
    return { transactions, periods, categories };
  }).catch(handleAuthErrorInPage);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          Your own expense submissions and their reimbursement status.
        </p>
        <NewTransactionButton
          orgId={org.id}
          periods={periods}
          categories={categories}
          isFinance={isFinance}
          currentUserId={user.id}
        />
      </div>
      <TransactionTable
        orgId={org.id}
        transactions={transactions}
        periods={periods}
        categories={categories}
        isFinance={isFinance}
        currentUserId={user.id}
      />
    </div>
  );
}
