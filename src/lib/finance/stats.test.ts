import { describe, expect, it } from "vitest";

import { TransactionStatus } from "@/generated/prisma/enums";

import { computeRunway, countsTowardBalance, formatFinanceDate, type RunwayInput } from "./stats";

const period = { startsOn: new Date("2026-06-01"), endsOn: new Date("2027-05-31") };
const now = new Date("2026-09-01T00:00:00Z");

function runway(overrides: Partial<RunwayInput> = {}) {
  return computeRunway({
    period,
    balanceCents: 0,
    spending: [],
    expectedIncomeCents: 0,
    meetingStarts: [],
    now,
    ...overrides,
  });
}

describe("countsTowardBalance", () => {
  it("leaves out drafts and rejected expenses and counts everything else", () => {
    expect(countsTowardBalance(TransactionStatus.DRAFT)).toBe(false);
    expect(countsTowardBalance(TransactionStatus.REJECTED)).toBe(false);
    expect(countsTowardBalance(TransactionStatus.SUBMITTED)).toBe(true);
    expect(countsTowardBalance(TransactionStatus.APPROVED)).toBe(true);
    expect(countsTowardBalance(TransactionStatus.REIMBURSED)).toBe(true);
    expect(countsTowardBalance(TransactionStatus.NOT_APPLICABLE)).toBe(true);
  });
});

describe("computeRunway", () => {
  it("averages spending over the meetings already held and projects the rest", () => {
    const r = runway({
      balanceCents: 100_000,
      spending: [{ amountCents: 30_000, occurredAt: new Date("2026-08-15") }],
      meetingStarts: [
        new Date("2026-07-01"),
        new Date("2026-08-01"),
        new Date("2026-08-20"),
        new Date("2026-10-01"),
      ],
    });
    expect(r.spentCents).toBe(30_000);
    expect(r.meetingsHeld).toBe(3);
    expect(r.meetingsScheduled).toBe(1);
    expect(r.avgSpendPerMeetingCents).toBe(10_000);
    expect(r.projectedMeetingCostCents).toBe(10_000);
  });

  it("has no per-meeting average before the first meeting", () => {
    const r = runway({
      spending: [{ amountCents: 30_000, occurredAt: new Date("2026-08-15") }],
      meetingStarts: [new Date("2026-10-01")],
    });
    expect(r.avgSpendPerMeetingCents).toBeNull();
    expect(r.projectedMeetingCostCents).toBeNull();
  });

  it("projects a run-out date from the trailing burn rate", () => {
    // 90 days of history, $900 spent in the window: $10 a day, so $300 lasts 30 days.
    const r = runway({
      balanceCents: 30_000,
      spending: [{ amountCents: 90_000, occurredAt: new Date("2026-08-01") }],
    });
    expect(r.burnWindowDays).toBe(90);
    expect(r.weeklyBurnCents).toBe(7_000);
    expect(r.runOutDate?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(r.status).toBe("short");
    expect(r.limitedHistory).toBe(false);
  });

  it("projects the balance left on the period's last day", () => {
    const r = runway({
      balanceCents: 500_000,
      spending: [{ amountCents: 90_000, occurredAt: new Date("2026-08-01") }],
    });
    // Sep 1 through May 31: 273 days at $10 a day.
    expect(r.daysLeftInPeriod).toBe(273);
    expect(r.projectedEndBalanceCents).toBe(500_000 - 273_000);
    expect(r.status).toBe("lasts");
  });

  it("ignores spending older than the burn window", () => {
    const r = runway({
      now: new Date("2027-01-01T00:00:00Z"),
      balanceCents: 300_000,
      spending: [{ amountCents: 200_000, occurredAt: new Date("2026-07-01") }],
    });
    expect(r.weeklyBurnCents).toBe(0);
    expect(r.runOutDate).toBeNull();
    expect(r.status).toBe("idle");
    expect(r.spentCents).toBe(200_000);
  });

  it("does not count spending dated after today toward the burn rate", () => {
    const r = runway({
      balanceCents: 30_000,
      spending: [
        { amountCents: 90_000, occurredAt: new Date("2026-08-01") },
        { amountCents: 50_000, occurredAt: new Date("2026-09-20") },
      ],
    });
    expect(r.weeklyBurnCents).toBe(7_000);
  });

  it("extends the runway with expected sponsorship income", () => {
    const r = runway({
      balanceCents: 30_000,
      expectedIncomeCents: 30_000,
      spending: [{ amountCents: 90_000, occurredAt: new Date("2026-08-01") }],
    });
    expect(r.runOutDate?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(r.runOutDateWithExpected?.toISOString()).toBe("2026-10-31T00:00:00.000Z");
    expect(r.statusWithExpected).toBe("short");
  });

  it("can carry the period past its end once the sponsorships arrive", () => {
    const r = runway({
      balanceCents: 30_000,
      expectedIncomeCents: 300_000,
      spending: [{ amountCents: 90_000, occurredAt: new Date("2026-08-01") }],
    });
    expect(r.status).toBe("short");
    expect(r.statusWithExpected).toBe("lasts");
  });

  it("reports a balance at or below zero as out of funds today", () => {
    const r = runway({
      balanceCents: -1_000,
      spending: [{ amountCents: 1_000, occurredAt: new Date("2026-08-15") }],
    });
    expect(r.status).toBe("out");
    expect(r.runOutDate).toEqual(now);
  });

  it("flags limited history early in the period and averages over the days so far", () => {
    const r = runway({
      now: new Date("2026-06-05T00:00:00Z"),
      balanceCents: 100_000,
      spending: [{ amountCents: 4_000, occurredAt: new Date("2026-06-02") }],
    });
    expect(r.limitedHistory).toBe(true);
    expect(r.burnWindowDays).toBe(4);
    expect(r.weeklyBurnCents).toBe(7_000);
  });

  it("keeps every amount in whole cents", () => {
    const r = runway({
      balanceCents: 100_001,
      spending: [
        { amountCents: 3_333, occurredAt: new Date("2026-08-15") },
        { amountCents: 3_334, occurredAt: new Date("2026-08-16") },
      ],
      meetingStarts: [new Date("2026-07-01"), new Date("2026-08-01"), new Date("2026-08-20")],
    });
    for (const value of [
      r.avgSpendPerMeetingCents,
      r.projectedMeetingCostCents,
      r.weeklyBurnCents,
      r.projectedEndBalanceCents,
    ]) {
      expect(Number.isInteger(value ?? 0)).toBe(true);
    }
  });
});

describe("formatFinanceDate", () => {
  it("prints the stored UTC date without shifting it", () => {
    expect(formatFinanceDate(new Date("2027-05-31"))).toBe("May 31, 2027");
  });
});
