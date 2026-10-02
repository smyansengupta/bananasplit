import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FinanceSetupState } from "@/lib/finance/setup";

/**
 * Finance › Set up: where it starts, what each step sends, and that every
 * step saves on its own and moves on.
 */

const m = vi.hoisted(() => ({
  createPeriod: vi.fn(),
  updatePeriod: vi.fn(),
  balance: vi.fn(),
  lines: vi.fn(),
  role: vi.fn(),
  board: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/app/app/[orgSlug]/finance/periods-actions", () => ({
  createBudgetPeriod: m.createPeriod,
  updateBudgetPeriod: m.updatePeriod,
}));
vi.mock("@/app/app/[orgSlug]/finance/setup-actions", () => ({ setStartingBalance: m.balance, saveBudgetLines: m.lines }));
vi.mock("@/app/app/[orgSlug]/settings/members/actions", () => ({ changeMemberRole: m.role }));
vi.mock("@/app/app/[orgSlug]/_shell/board-actions", () => ({ saveBoardAction: m.board }));
vi.mock("@/app/app/[orgSlug]/finance/import-actions", () => ({
  importFinanceRecords: vi.fn(),
  undoFinanceImport: vi.fn(),
  importFinanceBudget: vi.fn(),
  checkImportDuplicates: vi.fn(),
}));
vi.mock("@/app/app/[orgSlug]/_shell/ai-actions", () => ({ listAiConnectionsAction: vi.fn().mockResolvedValue([]) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push, refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { FinanceSetup } = await import("./finance-setup");

const fresh: FinanceSetupState = {
  period: null,
  startingBalance: null,
  transactionCount: 0,
  categoryCount: 0,
  budgeted: false,
  treasurerCount: 0,
  boardSaved: false,
};
const started: FinanceSetupState = {
  ...fresh,
  period: { id: "p1", label: "2026–27", startsOn: "2026-08-01", endsOn: "2027-07-31" },
  startingBalance: { cents: 100_000, asOf: "2026-08-01" },
  categoryCount: 2,
};

function show(state: FinanceSetupState) {
  render(
    <FinanceSetup
      orgId="org_1"
      orgSlug="cbc"
      today="2026-10-01"
      state={state}
      lines={state.period ? [{ id: "c1", name: "Food", allocatedCents: 0 }, { id: "c2", name: "Travel", allocatedCents: 5000 }] : []}
      periods={state.period ? [{ ...state.period, isActive: true }] : []}
      allCategories={[]}
      members={[
        { userId: "u1", name: "Jackson Lamoureux", role: "OWNER" },
        { userId: "u2", name: "Lucas Salzgeber", role: "ADMIN" },
        { userId: "u3", name: "Mehr Anand", role: "MEMBER" },
      ]}
      canAppoint
      currentUserId="u1"
      board={[{ id: "balance", type: "balance", w: 1, h: null }]}
    />,
  );
}

beforeEach(() => {
  for (const fn of [m.createPeriod, m.updatePeriod, m.balance, m.lines, m.role]) fn.mockResolvedValue({});
  m.board.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FinanceSetup", () => {
  it("starts a new club at its budget year and moves on once it's saved", async () => {
    show(fresh);
    expect(screen.getByRole("heading", { name: "Your money year" })).toBeTruthy();
    expect(screen.getByText("0 of 6 done")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start tracking" }));
    await waitFor(() =>
      expect(m.createPeriod).toHaveBeenCalledWith("org_1", { label: "2026–27", startsOn: "2026-08-01", endsOn: "2027-07-31" }),
    );
    expect(await screen.findByRole("heading", { name: "What you have now" })).toBeTruthy();
  });

  it("records the starting balance in cents, signed", async () => {
    show(fresh);
    fireEvent.click(screen.getByRole("button", { name: /What you have now/ }));
    fireEvent.change(screen.getByLabelText("Starting balance in dollars"), { target: { value: "-1,250.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Save -$1,250.50" }));
    await waitFor(() => expect(m.balance).toHaveBeenCalledWith("org_1", { cents: -125050, asOf: "2026-10-01" }));
  });

  it("opens where setup left off, and saves the budget as a list", async () => {
    show(started);
    expect(screen.getByRole("heading", { name: "Your budget" })).toBeTruthy();
    expect(screen.getByText("$50.00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "+ Merch" }));
    const amounts = screen.getAllByLabelText(/^Budget for/);
    fireEvent.change(amounts[0], { target: { value: "300" } });
    fireEvent.change(amounts[2], { target: { value: "75.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the budget" }));
    await waitFor(() =>
      expect(m.lines).toHaveBeenCalledWith("org_1", "p1", [
        { id: "c1", name: "Food", allocatedCents: 30000 },
        { id: "c2", name: "Travel", allocatedCents: 5000 },
        { id: null, name: "Merch", allocatedCents: 7550 },
      ]),
    );
  });

  it("makes a member treasurer, and offers only plain members", async () => {
    show(started);
    fireEvent.click(screen.getByRole("button", { name: /Who handles money/ }));
    const select = screen.getByRole("combobox", { name: "Make a member treasurer" }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual(["Choose a member…", "Mehr Anand"]);
    fireEvent.change(select, { target: { value: "u3" } });
    fireEvent.click(screen.getByRole("button", { name: "Make treasurer" }));
    await waitFor(() => expect(m.role).toHaveBeenCalledWith("org_1", "u3", "TREASURER"));
  });

  it("saves the picked widgets as the member's finance board", async () => {
    show(started);
    fireEvent.click(screen.getByRole("button", { name: /Your dashboard/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Shortcuts/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /^Balance ?Money in minus/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save my dashboard" }));
    await waitFor(() =>
      expect(m.board).toHaveBeenCalledWith("org_1", "finance", [{ id: "shortcuts", type: "shortcuts", w: 2, h: null }]),
    );
  });
});
