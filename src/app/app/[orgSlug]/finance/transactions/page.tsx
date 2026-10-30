import { TransactionTable } from "@/components/finance/transaction-table";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { planGate } from "@/server/billing/plan-gate";

import { FinanceAccessGate } from "../finance-access-gate";
import {
  filtersFromQuery,
  getCategoriesForPeriods,
  getOrgMembersForPicker,
  getOrgPeriods,
  getTransactions,
  transactionInclude,
} from "../queries";
import { TransactionFilters as TransactionFiltersBar } from "./transaction-filters";

const EMPTY: Record<string, string> = {
  review: "Nothing to review",
  pay: "Nothing to pay",
  unreconciled: "Everything is reconciled",
};

export default async function TransactionsPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/finance/transactions">) {
  const { orgSlug } = await params;
  const planLock = await planGate(orgSlug, "finance");
  if (planLock) return planLock;
  const query = await searchParams;
  const get = (key: string) => (typeof query[key] === "string" ? (query[key] as string) : null);

  const { organization: org, user, role } = await getOrgContextBySlug(orgSlug);
  // Not an owner, admin or treasurer: who is, and what to do instead (never an error page).
  if (!can({ role }, "finance.manage")) {
    return <FinanceAccessGate orgId={org.id} orgSlug={orgSlug} role={role} />;
  }

  const { view, filters } = filtersFromQuery(get);
  const openId = get("open") ?? undefined;

  const { transactions, periods, categories, memberships } = await withOrgTx(
    org.id,
    async ({ db }) => {
      let transactions = await getTransactions(db, org.id, filters);
      // A link to one transaction opens it even when the filters hide it.
      if (openId && !transactions.some((t) => t.id === openId)) {
        const found = await db.transaction.findFirst({
          where: { id: openId, organizationId: org.id },
          include: transactionInclude,
        });
        if (found) transactions = [found, ...transactions];
      }
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
    Object.entries(query).filter(([k, v]) => typeof v === "string" && k !== "open") as [
      string,
      string,
    ][],
  ).toString();

  return (
    <div className="space-y-4.5">
      <TransactionFiltersBar
        periods={periods}
        categories={categories}
        members={members}
        exportHref={`/app/${orgSlug}/finance/transactions/export?${exportQuery}`}
      />

      <TransactionTable
        key={openId ?? "list"}
        orgId={org.id}
        transactions={transactions}
        periods={periods}
        categories={categories}
        isFinance
        currentUserId={user.id}
        initialOpenId={openId}
        emptyDescription={EMPTY[view]}
      />
    </div>
  );
}
