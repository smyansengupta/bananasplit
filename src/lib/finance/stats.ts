import { TransactionStatus } from "@/generated/prisma/enums";

/**
 * Runway math for the finance dashboard and the org overview. Pure and
 * client-safe, so it is unit-tested with plain objects. Amounts are integer
 * cents; the balance it starts from is derived from the ledger, never stored.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The burn rate reads recent spending, so one expensive month doesn't skew it all year. */
export const BURN_WINDOW_DAYS = 90;

/** Below this many days of history the burn rate is too noisy to project from. */
export const MIN_HISTORY_DAYS = 14;

/**
 * Whether a (non-voided) transaction moves the balance. An expense still in
 * draft hasn't been claimed and a rejected one won't be paid, so neither ever
 * counts. A submitted expense does: the member has already paid and the club
 * owes it back unless it is rejected.
 */
export function countsTowardBalance(status: TransactionStatus): boolean {
  return status !== TransactionStatus.DRAFT && status !== TransactionStatus.REJECTED;
}

/**
 * out: nothing left to spend. short: runs out before the period ends.
 * lasts: still funded on the period's last day. idle: nothing spent in the
 * burn window, so there is nothing to project from.
 */
export type RunwayStatus = "out" | "short" | "lasts" | "idle";

export interface RunwayInput {
  /** Budget period bounds, stored as UTC dates; endsOn is the inclusive last day. */
  period: { startsOn: Date; endsOn: Date };
  balanceCents: number;
  /** The period's outgoing transactions that count toward the balance. */
  spending: readonly { amountCents: number; occurredAt: Date }[];
  /** Sponsorships committed or invoiced but not received yet. */
  expectedIncomeCents: number;
  /** Start times of the period's meetings, held and still scheduled. */
  meetingStarts: readonly Date[];
  now: Date;
}

export interface Runway {
  status: RunwayStatus;
  /** The status once the expected sponsorships arrive. */
  statusWithExpected: RunwayStatus;
  spentCents: number;
  meetingsHeld: number;
  meetingsScheduled: number;
  /** Spending ÷ meetings held so far; null before the first meeting. */
  avgSpendPerMeetingCents: number | null;
  /** The scheduled meetings at the current average; null before the first meeting. */
  projectedMeetingCostCents: number | null;
  weeklyBurnCents: number;
  /** Days of spending the burn rate averages: 90, or fewer early in the period. */
  burnWindowDays: number;
  /** True when the history is too short for the projection to mean much. */
  limitedHistory: boolean;
  /** When the balance reaches zero at the current burn rate; null when nothing is being spent. */
  runOutDate: Date | null;
  /** The same, counting expected sponsorships as income still to come. */
  runOutDateWithExpected: Date | null;
  /** The balance on the period's last day at the current burn rate. */
  projectedEndBalanceCents: number;
  daysLeftInPeriod: number;
}

export function computeRunway({
  period,
  balanceCents,
  spending,
  expectedIncomeCents,
  meetingStarts,
  now,
}: RunwayInput): Runway {
  let spentCents = 0;
  for (const t of spending) spentCents += t.amountCents;

  const meetingsHeld = meetingStarts.filter((d) => d.getTime() <= now.getTime()).length;
  const meetingsScheduled = meetingStarts.length - meetingsHeld;
  const avgSpendPerMeetingCents = meetingsHeld > 0 ? Math.round(spentCents / meetingsHeld) : null;

  const elapsedDays = Math.max(0, (now.getTime() - period.startsOn.getTime()) / DAY_MS);
  const burnWindowDays = Math.max(1, Math.min(BURN_WINDOW_DAYS, Math.floor(elapsedDays)));
  const windowStart = now.getTime() - burnWindowDays * DAY_MS;
  let windowSpentCents = 0;
  for (const t of spending) {
    const at = t.occurredAt.getTime();
    if (at > windowStart && at <= now.getTime()) windowSpentCents += t.amountCents;
  }
  // A rate, so fractional cents are kept until something is displayed.
  const dailyBurn = windowSpentCents / burnWindowDays;

  const periodEnd = period.endsOn.getTime() + DAY_MS;
  const daysLeftInPeriod = Math.max(0, Math.ceil((periodEnd - now.getTime()) / DAY_MS));

  function runOut(fromCents: number): Date | null {
    if (fromCents <= 0) return now;
    if (dailyBurn <= 0) return null;
    return new Date(now.getTime() + (fromCents / dailyBurn) * DAY_MS);
  }
  function statusOf(fromCents: number, runOutDate: Date | null): RunwayStatus {
    if (fromCents <= 0) return "out";
    if (!runOutDate) return "idle";
    return runOutDate.getTime() < periodEnd ? "short" : "lasts";
  }
  const withExpectedCents = balanceCents + Math.max(0, expectedIncomeCents);
  const runOutDate = runOut(balanceCents);
  const runOutDateWithExpected = runOut(withExpectedCents);

  return {
    status: statusOf(balanceCents, runOutDate),
    statusWithExpected: statusOf(withExpectedCents, runOutDateWithExpected),
    spentCents,
    meetingsHeld,
    meetingsScheduled,
    avgSpendPerMeetingCents,
    projectedMeetingCostCents:
      avgSpendPerMeetingCents === null ? null : avgSpendPerMeetingCents * meetingsScheduled,
    weeklyBurnCents: Math.round(dailyBurn * 7),
    burnWindowDays,
    limitedHistory: elapsedDays < MIN_HISTORY_DAYS,
    runOutDate,
    runOutDateWithExpected,
    projectedEndBalanceCents: Math.round(balanceCents - dailyBurn * daysLeftInPeriod),
    daysLeftInPeriod,
  };
}

const FINANCE_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** "Oct 3, 2026": a period bound (stored as a UTC date) or a projected date. */
export function formatFinanceDate(date: Date): string {
  return FINANCE_DATE.format(date);
}
