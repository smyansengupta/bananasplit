import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Finance's header: one primary button by role and page, the rest in the
 * "…" menu for owners and treasurers only.
 */

const nav = vi.hoisted(() => ({ pathname: "/app/cbc/finance" }));

vi.mock("@/components/links/linked-loader", () => ({ LinkedLoader: () => null }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/app/app/[orgSlug]/finance/transactions-actions", () => ({}));
vi.mock("@/app/app/[orgSlug]/finance/receipts-actions", () => ({}));

const { FinanceActions } = await import("./finance-actions");

const render = (isFinance: boolean, pathname: string) => {
  nav.pathname = pathname;
  return renderToStaticMarkup(
    <FinanceActions
      orgId="org_1"
      orgSlug="cbc"
      isFinance={isFinance}
      currentUserId="u1"
      periods={[]}
      categories={[]}
    />,
  );
};

describe("FinanceActions", () => {
  it("gives a treasurer Add transaction, with the rest in a menu", () => {
    const html = render(true, "/app/cbc/finance/transactions");
    expect(html).toContain("Add transaction");
    expect(html).not.toContain("Request a reimbursement");
    expect(html).toContain('aria-label="More finance actions"');
  });

  it("leads with Request a reimbursement on a treasurer's own reimbursements", () => {
    const html = render(true, "/app/cbc/finance/my-reimbursements");
    expect(html).toContain("Request a reimbursement");
    expect(html).not.toContain("Add transaction");
  });

  it("gives a member only Request a reimbursement, and no menu", () => {
    const html = render(false, "/app/cbc/finance/my-reimbursements");
    expect(html).toContain("Request a reimbursement");
    expect(html).not.toContain("Add transaction");
    expect(html).not.toContain("More finance actions");
  });
});
