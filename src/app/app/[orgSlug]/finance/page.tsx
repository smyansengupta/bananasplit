import { notFound, redirect } from "next/navigation";

import { Role } from "@/generated/prisma/client";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { requireOrgMembership, type OrgContext } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { DashboardView } from "@/components/finance/dashboard-view";

import { getDashboardData, getMoneyOwedToUser } from "./queries";

export default async function FinancePage({ params }: PageProps<"/app/[orgSlug]/finance">) {
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
  if (!isFinance) {
    redirect(`/app/${orgSlug}/finance/my-reimbursements`);
  }

  const [dashboard, moneyOwedToYouCents] = await Promise.all([
    getDashboardData(org.id),
    getMoneyOwedToUser(org.id, ctx.user.id),
  ]);

  return (
    <DashboardView data={dashboard} orgSlug={orgSlug} moneyOwedToYouCents={moneyOwedToYouCents} />
  );
}
