import { notFound } from "next/navigation";

import { Role } from "@/generated/prisma/client";
import { NewTransactionButton, TransactionTable } from "@/components/finance/transaction-table";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { requireOrgMembership, type OrgContext } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

import { getMyReimbursements, getOrgPeriods } from "../queries";

export default async function MyReimbursementsPage({
  params,
}: PageProps<"/app/[orgSlug]/finance/my-reimbursements">) {
  const { orgSlug } = await params;

  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) {
    notFound();
  }

  let ctx: OrgContext;
  try {
    ctx = await requireOrgMembership(org.id);
  } catch (error) {
    handleAuthErrorInPage(error);
  }

  const isFinance = ctx.role === Role.OWNER || ctx.role === Role.TREASURER;
  const [transactions, periods] = await Promise.all([
    getMyReimbursements(org.id, ctx.user.id),
    getOrgPeriods(org.id),
  ]);
  const categories = (
    await Promise.all(
      periods.map((p) => prisma.budgetCategory.findMany({ where: { budgetPeriodId: p.id } })),
    )
  ).flat();

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
          currentUserId={ctx.user.id}
        />
      </div>
      <TransactionTable
        orgId={org.id}
        transactions={transactions}
        periods={periods}
        categories={categories}
        isFinance={isFinance}
        currentUserId={ctx.user.id}
      />
    </div>
  );
}
