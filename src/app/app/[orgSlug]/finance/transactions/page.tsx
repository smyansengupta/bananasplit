import { Download } from "lucide-react";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { NewTransactionButton, TransactionTable } from "@/components/finance/transaction-table";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { requireFinanceAccess } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

import {
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

  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) {
    notFound();
  }

  let ctx;
  try {
    ctx = await requireFinanceAccess(org.id);
  } catch (error) {
    handleAuthErrorInPage(error);
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
  };

  const [transactions, periods, memberships] = await Promise.all([
    getTransactions(org.id, filters),
    getOrgPeriods(org.id),
    getOrgMembersForPicker(org.id),
  ]);
  const categories = (
    await Promise.all(
      periods.map((p) => prisma.budgetCategory.findMany({ where: { budgetPeriodId: p.id } })),
    )
  ).flat();
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
            currentUserId={ctx.user.id}
          />
        </div>
      </div>

      <TransactionTable
        orgId={org.id}
        transactions={transactions}
        periods={periods}
        categories={categories}
        isFinance
        currentUserId={ctx.user.id}
      />
    </div>
  );
}
