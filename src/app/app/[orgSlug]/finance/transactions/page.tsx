import { Download } from "@/components/icons";

import { Button } from "@/components/ui/button";
import { TransactionTable } from "@/components/finance/transaction-table";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { planGate } from "@/server/billing/plan-gate";

import { FinanceAccessGate } from "../finance-access-gate";
import {
  getCategoriesForPeriods,
  getOrgMembersForPicker,
  getOrgPeriods,
  getTransactions,
  type TransactionFilters,
} from "../queries";
import { TransactionFilters as TransactionFiltersBar } from "./transaction-filters";

export default async function TransactionsPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/finance/transactions">) {
  const { orgSlug } = await params;
  const planLock = await planGate(orgSlug, "finance");
  if (planLock) return planLock;
  const query = await searchParams;

  const { organization: org, user, role } = await getOrgContextBySlug(orgSlug);
  // Not an owner, admin or treasurer: who is, and what to do instead (never an error page).
  if (!can({ role }, "finance.manage")) {
    return <FinanceAccessGate orgId={org.id} orgSlug={orgSlug} role={role} />;
  }

  const filters: TransactionFilters = {
    budgetPeriodId: typeof query.period === "string" ? query.period : undefined,
    categoryId: typeof query.category === "string" ? query.category : undefined,
    kind: typeof query.kind === "string" ? (query.kind as TransactionFilters["kind"]) : undefined,
    status:
      typeof query.status === "string" ? (query.status as TransactionFilters["status"]) : undefined,
    submittedById: typeof query.submitter === "string" ? query.submitter : undefined,
    dateFrom: typeof query.dateFrom === "string" ? query.dateFrom : undefined,
    dateTo: typeof query.dateTo === "string" ? query.dateTo : undefined,
    reconciled:
      query.reconciled === "yes" || query.reconciled === "no" ? query.reconciled : undefined,
    deleted: query.deleted === "show" ? "show" : undefined,
  };

  const { transactions, periods, categories, memberships } = await withOrgTx(
    org.id,
    async ({ db }) => {
      const transactions = await getTransactions(db, org.id, filters);
      const periods = await getOrgPeriods(db, org.id);
      const categories = await getCategoriesForPeriods(db, org.id, periods);
      const memberships = await getOrgMembersForPicker(db, org.id);
      return { transactions, periods, categories, memberships };
    },
  ).catch(handleAuthErrorInPage);
  const members = memberships.map((m) => ({
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
  }));

  const exportQuery = new URLSearchParams(
    Object.entries(query).filter(([, v]) => typeof v === "string") as [string, string][],
  ).toString();

  // Add transaction is in the Finance header; Show deleted is one of the filters.
  return (
    <div className="space-y-4.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TransactionFiltersBar periods={periods} categories={categories} members={members} />
        <Button variant="outline" asChild>
          <a href={`/app/${orgSlug}/finance/transactions/export?${exportQuery}`}>
            <Download className="size-4" aria-hidden="true" />
            Export CSV
          </a>
        </Button>
      </div>

      <TransactionTable
        orgId={org.id}
        transactions={transactions}
        periods={periods}
        categories={categories}
        isFinance
        currentUserId={user.id}
      />
    </div>
  );
}
