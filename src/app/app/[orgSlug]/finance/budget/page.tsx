import { notFound } from "next/navigation";

import { BudgetView } from "@/components/finance/budget-view";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { requireFinanceAccess } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

import { getCategoriesForPeriod, getOrgPeriods } from "../queries";

export default async function BudgetPage({ params }: PageProps<"/app/[orgSlug]/finance/budget">) {
  const { orgSlug } = await params;

  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) {
    notFound();
  }

  try {
    await requireFinanceAccess(org.id);
  } catch (error) {
    handleAuthErrorInPage(error);
  }

  const periods = await getOrgPeriods(org.id);
  const activePeriod = periods.find((p) => p.isActive) ?? null;
  const categories = activePeriod ? await getCategoriesForPeriod(activePeriod.id) : [];

  return (
    <BudgetView
      orgId={org.id}
      periods={periods}
      activePeriodId={activePeriod?.id ?? null}
      categories={categories}
    />
  );
}
