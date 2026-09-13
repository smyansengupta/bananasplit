import { notFound } from "next/navigation";

import { Role } from "@/generated/prisma/client";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { requireOrgMembership } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

import { FinanceSubnav } from "./finance-subnav";

export default async function FinanceLayout({
  params,
  children,
}: LayoutProps<"/app/[orgSlug]/finance">) {
  const { orgSlug } = await params;

  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) {
    notFound();
  }

  let role: Role;
  try {
    role = (await requireOrgMembership(org.id)).role;
  } catch (error) {
    handleAuthErrorInPage(error);
  }

  const isFinance = role === Role.OWNER || role === Role.TREASURER;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
        <FinanceSubnav orgSlug={orgSlug} isFinance={isFinance} />
      </div>
      {children}
    </div>
  );
}
