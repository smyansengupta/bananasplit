import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DashboardData } from "@/app/app/[orgSlug]/finance/queries";
import { computeRunway, type RunwayInput } from "@/lib/finance/stats";

import { DashboardView } from "./dashboard-view";

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
  };
}

const render = (data: DashboardData) =>
  renderToStaticMarkup(<DashboardView data={data} orgSlug="cbc" moneyOwedToYouCents={0} />);

describe("DashboardView runway", () => {
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

  it("has no runway without an active period", () => {
    const html = render({ ...dashboard({}), period: null, runway: null });
    expect(html).toContain("No active budget period yet.");
    expect(html).not.toContain("Runway");
  });
});
