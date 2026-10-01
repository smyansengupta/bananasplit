import { BudgetView } from "@/components/finance/budget-view";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { can } from "@/lib/auth/permissions";
import { toDateValue } from "@/lib/finance/periods";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";

import { FinanceAccessGate } from "../finance-access-gate";
import { getCategoriesForPeriod, getOrgPeriods } from "../queries";

export default async function BudgetPage({ params }: PageProps<"/app/[orgSlug]/finance/budget">) {
  const { orgSlug } = await params;
  const { organization: org, role } = await getOrgContextBySlug(orgSlug);
  // Not an owner or treasurer: who is, and what to do instead (never an error page).
  if (!can({ role }, "finance.manage")) {
    return <FinanceAccessGate orgId={org.id} orgSlug={orgSlug} role={role} />;
  }

  const { periods, activePeriod, categories, spent, counts } = await withOrgTx(org.id, async ({ db }) => {
    const periods = await getOrgPeriods(db, org.id);
    const activePeriod = periods.find((p) => p.isActive) ?? null;
    if (!activePeriod) return { periods, activePeriod, categories: [], spent: [], counts: [] };
    const categories = await getCategoriesForPeriod(db, org.id, activePeriod.id);
    // Spent = money out that counts toward the balance: not voided, and not
    // an expense still in draft or rejected (the dashboard's rule).
    const spent = await db.transaction.groupBy({
      by: ["categoryId"],
      where: {
        organizationId: org.id,
        budgetPeriodId: activePeriod.id,
        voidedAt: null,
        direction: "OUT",
        status: { notIn: ["DRAFT", "REJECTED"] },
      },
      _sum: { amountCents: true },
    });
    const counts = await db.transaction.groupBy({
      by: ["categoryId"],
      where: { organizationId: org.id, budgetPeriodId: activePeriod.id },
      _count: { _all: true },
    });
    return { periods, activePeriod, categories, spent, counts };
  }).catch(handleAuthErrorInPage);

  const spentBy = new Map(spent.map((s) => [s.categoryId, s._sum.amountCents ?? 0]));
  const countBy = new Map(counts.map((c) => [c.categoryId, c._count._all]));

  return (
    <BudgetView
      orgId={org.id}
      periods={periods.map((p) => ({
        id: p.id,
        label: p.label,
        startsOn: toDateValue(p.startsOn),
        endsOn: toDateValue(p.endsOn),
        isActive: p.isActive,
      }))}
      activePeriodId={activePeriod?.id ?? null}
      categories={categories.map((c) => ({
        id: c.id,
        name: c.name,
        allocatedCents: c.allocatedCents,
        spentCents: spentBy.get(c.id) ?? 0,
        transactionCount: countBy.get(c.id) ?? 0,
      }))}
    />
  );
}
