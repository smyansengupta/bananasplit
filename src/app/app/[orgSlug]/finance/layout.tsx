import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug } from "@/server/db/context";

import { FinanceSubnav } from "./finance-subnav";

export default async function FinanceLayout({
  params,
  children,
}: LayoutProps<"/app/[orgSlug]/finance">) {
  const { orgSlug } = await params;
  // Unknown slug or not a member: notFound() (getOrgContextBySlug).
  const { role } = await getOrgContextBySlug(orgSlug);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Finance</h1>
        <FinanceSubnav orgSlug={orgSlug} isFinance={can({ role }, "finance.manage")} />
      </div>
      {children}
    </div>
  );
}
