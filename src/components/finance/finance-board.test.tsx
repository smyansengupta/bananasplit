import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { DashboardData } from "@/app/app/[orgSlug]/finance/queries";
import { computeRunway, type RunwayInput } from "@/lib/finance/stats";

import type { BoardWidget as Widget } from "@/lib/boards";
import { resolveLayout } from "@/lib/finance/widgets";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/app/[orgSlug]/_shell/board-actions", () => ({ saveBoardAction: vi.fn() }));

const { FinanceBoard } = await import("./finance-board");

const period = { startsOn: new Date("2026-07-01"), endsOn: new Date("2027-06-30") };
const now = new Date("2026-10-05T12:00:00Z");

function dashboard(runway: Partial<RunwayInput>): DashboardData {
  const input: RunwayInput = {
    period,
    balanceCents: 30_000,
    spending: [{ amountCents: 90_000, occurredAt: new Date("2026-09-01") }],
    expectedIncomeCents: 0,
    meetingStarts: [new Date("2026-09-10"), new Date("2026-09-24"), new Date("2026-10-15")],
    now,
    ...runway,
  };
  return {
    period: { id: "p_1", label: "FY 2026-27", ...period },
    balanceCents: input.balanceCents,
    totalAllocatedCents: 0,
    categories: [],
    outstandingReimbursementsCents: 0,
    sponsorshipCommittedCents: input.expectedIncomeCents,
    sponsorshipReceivedCents: 0,
    burnByMonth: [],
    unreconciledOver60DaysCount: 0,
    runway: computeRunway(input),
    inTotalCents: 120_000,
    outTotalCents: 90_000,
    pendingApproval: { count: 2, cents: 4_500 },
    spendByKind: [],
    balanceTrend: [],
    recent: [],
    topExpenses: [],
    incomeByKind: [],
    reimbursementQueue: [],
  };
}

const RUNWAY: Widget[] = [{ id: "runway", type: "runway", w: 4, h: null }];

const render = (data: DashboardData, layout: Widget[] = RUNWAY) =>
  renderToStaticMarkup(
    <FinanceBoard orgId="org_1" orgSlug="cbc" data={data} initialLayout={layout} customized={false} />,
  );

describe("finance board: the runway widget", () => {
  it("says when the money runs out, in words, with the rate it assumes", () => {
    const html = render(dashboard({}));
    expect(html).toContain("When the money runs out");
    // $900 over 90 days is $10 a day: $300 lasts 30 days.
    expect(html).toContain("Runs out Nov 4, 2026");
    expect(html).toContain("At $70.00 a week, before the period ends on Jun 30, 2027.");
  });

  it("averages spending over the meetings held and prices the ones still scheduled", () => {
    const html = render(dashboard({}));
    expect(html).toContain("Average spend per meeting");
    expect(html).toContain("$450.00");
    expect(html).toContain("$900.00 over 2 meetings held");
    expect(html).toContain("About $450.00 at the current average");
    expect(html).toContain("calendar events other than board meetings");
  });

  it("shows what committed sponsorships would change", () => {
    const html = render(dashboard({ expectedIncomeCents: 1_000_000 }));
    expect(html).toContain("With $10,000.00 in committed sponsorships: lasts past Jun 30, 2027.");
  });

  it("says so when nothing has been spent recently instead of projecting", () => {
    const html = render(dashboard({ spending: [] }));
    expect(html).toContain("No recent spending");
    expect(html).not.toContain("Runs out");
  });

  it("marks a balance at or below zero as out of funds", () => {
    const html = render(dashboard({ balanceCents: -500 }));
    expect(html).toContain("Out of funds");
  });

  it("shows each number widget with where to act on it", () => {
    const html = render(dashboard({}), [
      { id: "in-out", type: "in-out", w: 1, h: null },
      { id: "pending", type: "pending", w: 1, h: 200 },
    ]);
    expect(html).toContain("In and out");
    expect(html).toContain("$1,200");
    expect(html).toContain("Waiting for approval");
    expect(html).toContain("$45.00 to review");
    expect(html).toContain('href="/app/cbc/finance/transactions?status=SUBMITTED"');
  });

  it("offers a way back when the board is empty", () => {
    expect(render(dashboard({}), [])).toContain("Your board is empty. Add a widget.");
  });
});

describe("finance board layout", () => {
  it("starts from the default, trimmed to the sections the org chose", () => {
    const all = resolveLayout(null, new Set(["categories", "runway", "sponsorships", "burn"]));
    expect(all.map((w) => w.type)).toContain("runway");
    const noRunway = resolveLayout(null, new Set(["categories"]));
    expect(noRunway.map((w) => w.type)).not.toContain("runway");
    expect(noRunway.map((w) => w.type)).toContain("balance");
  });

  it("keeps a member's saved board, reads the old size-only shape, and ignores one that doesn't parse", () => {
    const saved = [{ id: "trend", type: "trend", w: 3, h: 340 }];
    expect(resolveLayout(saved, new Set())).toEqual(saved);
    expect(resolveLayout([{ id: "trend", type: "trend", size: "lg" }], new Set())).toEqual([
      { id: "trend", type: "trend", w: 4, h: null },
    ]);
    // Heights snap to 20px and stay within bounds; widths to 1-4 columns.
    expect(resolveLayout([{ id: "a", type: "trend", w: 9, h: 5 }], new Set())).toEqual([
      { id: "a", type: "trend", w: 4, h: 120 },
    ]);
    expect(resolveLayout([{ id: "x", type: "nope", w: 1 }], new Set(["runway"]))).toEqual([]);
    expect(resolveLayout("garbage", new Set(["runway"])).length).toBeGreaterThan(1);
  });
});
