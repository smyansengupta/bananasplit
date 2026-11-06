import { FinanceActions } from "@/components/finance/finance-actions";
import { PageHeader } from "@/components/page-header";
import { BarSlotProvider } from "@/components/ui/bar-slot";
import { PageTabs } from "@/components/ui/page-tabs";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { can } from "@/lib/auth/permissions";
import { spaceIncludes } from "@/lib/billing/space";
import { sectionLabel } from "@/lib/nav/sidebar";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";

import { getCategoryOptions, getOrgPeriods } from "./queries";

/**
 * Every finance page's header: the title and, for the treasurer, one short
 * line (the budget year and how many requests wait); Add transaction
 * (Request a reimbursement for a member) with the other entry, Import and
 * Setup in its chevron; and, for owners, admins and treasurers, the pages as
 * tabs. A member only has their own requests, so they get no tabs. The tabs
 * are one bar with the page's own controls on its right (<InBar>: the
 * dashboard's Customize, the transactions' Filters, search and Export).
 */
export default async function FinanceLayout({
  params,
  children,
}: LayoutProps<"/app/[orgSlug]/finance">) {
  const { orgSlug } = await params;
  // Unknown slug or not a member: notFound() (getOrgContextBySlug).
  const { organization: org, user, role, settings } = await getOrgContextBySlug(orgSlug);
  // Not on the plan: the page shows the upgrade screen, without the header.
  if (!spaceIncludes(org, "finance")) return children;
  const isFinance = can({ role }, "finance.manage");
  // For the header's new-entry dialog (which period, which category).
  const { periods, categories } = await withOrgTx(org.id, async ({ db }) => {
    const periods = await getOrgPeriods(db, org.id);
    return {
      periods,
      // Names only (no amounts): a member opens this layout too.
      categories: await getCategoryOptions(db, periods),
    };
  }).catch(handleAuthErrorInPage);
  const base = `/app/${orgSlug}/finance`;
  const active = periods.find((p) => p.isActive);
  // The budget year, for the people who run the money. Requests waiting are
  // counted on the sidebar and in the Inbox, not here as well.
  const summary = isFinance ? active?.label : undefined;

  return (
    <div className="space-y-7.5">
      <PageHeader
        title={sectionLabel(settings?.sidebar, "finance")}
        description={summary}
        actions={
          <FinanceActions
            orgId={org.id}
            orgSlug={orgSlug}
            isFinance={isFinance}
            currentUserId={user.id}
            // The active period first: a new entry defaults to it.
            periods={[...periods]
              .sort((a, b) => Number(b.isActive) - Number(a.isActive))
              .map((p) => ({ id: p.id, label: p.label }))}
            categories={categories.map((c) => ({
              id: c.id,
              name: c.name,
              budgetPeriodId: c.budgetPeriodId,
            }))}
          />
        }
      />
      <BarSlotProvider
        bar={
          isFinance ? (
            <PageTabs
              label="Finance"
              tabs={[
                { label: "Dashboard", href: base, exact: true },
                { label: "Transactions", href: `${base}/transactions` },
                { label: "Budget", href: `${base}/budget` },
                ...(spaceIncludes(org, "sponsorships")
                  ? [{ label: "Deals", href: `${base}/deals` }]
                  : []),
                { label: "My requests", href: `${base}/my-reimbursements` },
              ]}
            />
          ) : null
        }
      >
        {children}
      </BarSlotProvider>
    </div>
  );
}
