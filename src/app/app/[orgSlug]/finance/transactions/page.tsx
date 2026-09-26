import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NewTransactionButton, TransactionTable } from "@/components/finance/transaction-table";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { requirePermission } from "@/lib/auth/permissions";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";

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
  const query = await searchParams;

  const { organization: org, user, role } = await getOrgContextBySlug(orgSlug);
  // ForbiddenError renders the segment's "no access" state (error.tsx).
  requirePermission({ role }, "finance.manage");

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TransactionFiltersBar periods={periods} categories={categories} members={members} />
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <a href={`/app/${orgSlug}/finance/transactions/export?${exportQuery}`}>
              <Download className="size-4" />
              Export CSV
            </a>
          </Button>
          <NewTransactionButton
            orgId={org.id}
            periods={periods}
            categories={categories}
            isFinance
            currentUserId={user.id}
          />
        </div>
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
