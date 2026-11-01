import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SUGGESTED_CATEGORIES, type FinanceSetupState } from "@/lib/finance/setup";

/** Finance setup on one screen: what you have, the budget lines, one Save. */

const m = vi.hoisted(() => ({ balance: vi.fn(), lines: vi.fn(), push: vi.fn() }));

vi.mock("@/app/app/[orgSlug]/finance/setup-actions", () => ({
  setStartingBalance: m.balance,
  saveBudgetLines: m.lines,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push, refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { QuickFinanceSetup } = await import("./quick-setup");

const fresh: FinanceSetupState = {
  period: null,
  startingBalance: null,
  transactionCount: 0,
  categoryCount: 0,
  budgeted: false,
  treasurerCount: 0,
  boardSaved: false,
};

beforeEach(() => {
  m.balance.mockResolvedValue({ transactionId: "t1" });
  m.lines.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("QuickFinanceSetup", () => {
  it("saves the starting balance and the budget lines with one Save", async () => {
    render(
      <QuickFinanceSetup orgId="o1" orgSlug="club" today="2026-10-31" state={fresh} lines={[]} />,
    );
    fireEvent.change(screen.getByLabelText("You have"), { target: { value: "1,240" } });
    fireEvent.change(screen.getByLabelText("Budget line 1 name"), { target: { value: "Food" } });
    fireEvent.change(screen.getByLabelText("Budget line 1 amount"), { target: { value: "400" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(m.lines).toHaveBeenCalled());
    expect(m.balance).toHaveBeenCalledWith("o1", { cents: 124000, asOf: "2026-10-31" });
    // No period yet: the save starts the budget year.
    expect(m.lines).toHaveBeenCalledWith("o1", null, [
      { id: null, name: "Food", allocatedCents: 40000 },
    ]);
    expect(m.push).toHaveBeenCalledWith("/app/club/finance");
  });

  it("adds a suggested line in one click, and offers a treasurer only when there is none", () => {
    render(
      <QuickFinanceSetup orgId="o1" orgSlug="club" today="2026-10-31" state={fresh} lines={[]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: SUGGESTED_CATEGORIES[0] }));
    expect((screen.getByLabelText("Budget line 1 name") as HTMLInputElement).value).toBe(
      SUGGESTED_CATEGORIES[0],
    );
    expect(screen.getByText("Choose a treasurer")).toBeTruthy();
  });

  it("reads a negative balance as owed", async () => {
    render(
      <QuickFinanceSetup orgId="o1" orgSlug="club" today="2026-10-31" state={fresh} lines={[]} />,
    );
    fireEvent.change(screen.getByLabelText("You have"), { target: { value: "-50" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(m.balance).toHaveBeenCalledWith("o1", { cents: -5000, asOf: "2026-10-31" }),
    );
  });
});
