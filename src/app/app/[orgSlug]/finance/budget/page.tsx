import { BudgetView } from "@/components/finance/budget-view";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { requirePermission } from "@/lib/auth/permissions";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";

import { getCategoriesForPeriod, getOrgPeriods } from "../queries";

export default async function BudgetPage({ params }: PageProps<"/app/[orgSlug]/finance/budget">) {
  const { orgSlug } = await params;
  const { organization: org, role } = await getOrgContextBySlug(orgSlug);
  // ForbiddenError renders the segment's "no access" state (error.tsx).
  requirePermission({ role }, "finance.manage");

  const { periods, activePeriod, categories } = await withOrgTx(org.id, async ({ db }) => {
    const periods = await getOrgPeriods(db, org.id);
    const activePeriod = periods.find((p) => p.isActive) ?? null;
    const categories = activePeriod ? await getCategoriesForPeriod(db, org.id, activePeriod.id) : [];
    return { periods, activePeriod, categories };
  }).catch(handleAuthErrorInPage);

  return (
    <BudgetView
      orgId={org.id}
      periods={periods}
      activePeriodId={activePeriod?.id ?? null}
      categories={categories}
    />
  );
}
