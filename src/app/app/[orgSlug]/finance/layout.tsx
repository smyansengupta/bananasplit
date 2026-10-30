import { FinanceActions } from "@/components/finance/finance-actions";
import { PageHeader } from "@/components/page-header";
import { PageTabs } from "@/components/ui/page-tabs";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { can } from "@/lib/auth/permissions";
import { spaceIncludes } from "@/lib/billing/space";
import { sectionLabel } from "@/lib/nav/sidebar";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";

import { countAwaitingApproval, getCategoryOptions, getOrgPeriods } from "./queries";

/**
 * Every finance page's header: the title and, for the treasurer, one short
 * line (the budget year and how many requests wait); Add transaction
 * (Request a reimbursement for a member) with the other entry, Import and
 * Setup in its chevron; and, for owners, admins and treasurers, the pages as
 * tabs. A member only has their own requests, so they get no tabs.
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
  const { periods, categories, toReview } = await withOrgTx(org.id, async ({ db }) => {
    const periods = await getOrgPeriods(db, org.id);
    return {
      periods,
      // Names only (no amounts): a member opens this layout too.
      categories: await getCategoryOptions(db, periods),
      // The header's live line: requests waiting on an owner, admin or treasurer.
      toReview: isFinance ? await countAwaitingApproval(db, org.id) : 0,
    };
  }).catch(handleAuthErrorInPage);
  const base = `/app/${orgSlug}/finance`;
  const active = periods.find((p) => p.isActive);
  // One short line, only when it says something: the budget year, and the
  // requests waiting (the sidebar carries the same count).
  const summary = isFinance
    ? [active?.label, toReview > 0 && `${toReview} to review`].filter(Boolean).join(", ") ||
      undefined
    : undefined;

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
        tabs={
          isFinance ? (
            <PageTabs
              label="Finance"
              tabs={[
                { label: "Dashboard", href: base, exact: true },
                { label: "Transactions", href: `${base}/transactions` },
                { label: "Budget", href: `${base}/budget` },
                ...(spaceIncludes(org, "sponsorships")
                  ? [{ label: "Sponsorships", href: `${base}/sponsorships` }]
                  : []),
                { label: "My requests", href: `${base}/my-reimbursements` },
              ]}
            />
          ) : undefined
        }
      />
      {children}
    </div>
  );
}
