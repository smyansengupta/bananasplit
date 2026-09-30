import { redirect } from "next/navigation";

import { DashboardView } from "@/components/finance/dashboard-view";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { can } from "@/lib/auth/permissions";
import { visibleFinanceCards } from "@/lib/finance/dashboard-cards";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";

import { getDashboardData, getMoneyOwedToUser } from "./queries";

export default async function FinancePage({ params }: PageProps<"/app/[orgSlug]/finance">) {
  const { orgSlug } = await params;
  const { organization: org, user, role, settings } = await getOrgContextBySlug(orgSlug);

  if (!can({ role }, "finance.manage")) {
    redirect(`/app/${orgSlug}/finance/my-reimbursements`);
  }

  const { dashboard, moneyOwedToYouCents } = await withOrgTx(org.id, async ({ db }) => ({
    dashboard: await getDashboardData(db, org.id),
    moneyOwedToYouCents: await getMoneyOwedToUser(db, org.id, user.id),
  })).catch(handleAuthErrorInPage);

  return (
    <DashboardView
      data={dashboard}
      orgSlug={orgSlug}
      moneyOwedToYouCents={moneyOwedToYouCents}
      cards={visibleFinanceCards(settings?.financeDashboardCards)}
    />
  );
}
