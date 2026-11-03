/**
 * When Finance's ambient buttons show (Buttons canvas, Finance): Ask for
 * receipt on an expense with none, Move money on a budget line past 90%,
 * Mark paid on an approved request, and Send a reminder on a sponsor's
 * late invoice. Pure, so the pages decide and the tests pin it.
 */

const DAY = 86_400_000;

/** A budget line is running hot past this share spent. */
export const HOT_SHARE = 0.9;
/** Move money tops a hot line up to this share spent. */
const TARGET_SHARE = 0.8;
/** A line can give when it has spent less than this share. */
const DONOR_SHARE = 0.7;
/** Amounts are moved in whole $10s. */
const STEP_CENTS = 1_000;

function daysSince(at: Date | string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(at).getTime()) / DAY));
}

function ago(d: number): string {
  return d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

function money(cents: number): string {
  const dollars = cents / 100;
  return `$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export interface LedgerFacts {
  kind: string;
  direction: string;
  status: string;
  voidedAt: Date | string | null;
  reconciledAt?: Date | string | null;
  occurredAt: Date | string;
  approvedAt?: Date | string | null;
  submittedById: string;
  receipts: number;
}

/**
 * Ask for receipt: money that went out on an expense, a day or more ago,
 * with no receipt, paid by someone else (your own you attach yourself). A
 * request still waiting is reviewed instead (Approve or Decline).
 */
export function needsReceipt(t: LedgerFacts, viewerId: string, now: Date): boolean {
  return (
    t.kind === "EXPENSE" &&
    t.direction === "OUT" &&
    !t.voidedAt &&
    t.receipts === 0 &&
    t.submittedById !== viewerId &&
    ["APPROVED", "REIMBURSED", "NOT_APPLICABLE"].includes(t.status) &&
    daysSince(t.occurredAt, now) >= 1
  );
}

/** "Paid 3 days ago, no receipt". */
export function receiptReason(t: Pick<LedgerFacts, "occurredAt">, now: Date): string {
  return `Paid ${ago(daysSince(t.occurredAt, now))}, no receipt`;
}

/** Ask for it: "Ask Alex for it". */
export function askLabel(name: string | null | undefined): string {
  const first = name?.trim().split(/\s+/)[0];
  return first ? `Ask ${first} for it` : "Ask for receipt";
}

/** Mark paid: approved, not paid, someone else's (nobody pays themselves back). */
export function approvedNotPaid(t: LedgerFacts, viewerId: string): boolean {
  return (
    t.kind === "EXPENSE" &&
    t.status === "APPROVED" &&
    !t.voidedAt &&
    !t.reconciledAt &&
    t.submittedById !== viewerId
  );
}

/** "Approved 3 days ago, not paid". */
export function unpaidReason(t: Pick<LedgerFacts, "approvedAt" | "occurredAt">, now: Date): string {
  return `Approved ${ago(daysSince(t.approvedAt ?? t.occurredAt, now))}, not paid`;
}

export interface BudgetLine {
  id: string;
  name: string;
  allocatedCents: number;
  spentCents: number;
}

/** A line past 90% of its budget (and not over it already by nothing budgeted). */
export function isHot(line: BudgetLine): boolean {
  return line.allocatedCents > 0 && line.spentCents / line.allocatedCents > HOT_SHARE;
}

/**
 * Move money into a hot line: from the line with the most left that has
 * spent under 70%, enough to bring the hot one back to 80% spent (in $10s),
 * and never more than half of what the giver has left. Null when no line
 * can give.
 */
export function moveMoneyPlan(
  hot: BudgetLine,
  lines: readonly BudgetLine[],
): { fromId: string; fromName: string; cents: number; label: string; reason: string } | null {
  if (!isHot(hot)) return null;
  const donors = lines
    .filter(
      (l) =>
        l.id !== hot.id &&
        l.allocatedCents > 0 &&
        l.spentCents / l.allocatedCents < DONOR_SHARE &&
        l.allocatedCents - l.spentCents > 0,
    )
    .sort((a, b) => b.allocatedCents - b.spentCents - (a.allocatedCents - a.spentCents));
  const donor = donors[0];
  if (!donor) return null;
  const need = Math.ceil(hot.spentCents / TARGET_SHARE) - hot.allocatedCents;
  const room = Math.floor((donor.allocatedCents - donor.spentCents) / 2 / STEP_CENTS) * STEP_CENTS;
  const cents = Math.min(Math.max(STEP_CENTS, Math.ceil(need / STEP_CENTS) * STEP_CENTS), room);
  if (cents < STEP_CENTS) return null;
  const pct = Math.round((hot.spentCents / hot.allocatedCents) * 100);
  return {
    fromId: donor.id,
    fromName: donor.name,
    cents,
    label: `Move ${money(cents)} from ${donor.name}`,
    reason: `${pct}% spent, ${donor.name} has ${money(donor.allocatedCents - donor.spentCents)} left`,
  };
}

/** Send a reminder: invoiced, and the money was due before today. */
export function invoiceLate(
  s: { status: string; expectedOn: Date | string | null },
  now: Date,
): number | null {
  if (s.status !== "INVOICED" || !s.expectedOn) return null;
  const late = daysSince(s.expectedOn, now);
  return late >= 1 ? late : null;
}

/** "Due Oct 20, 13 days late". */
export function lateReason(expectedOn: Date | string, late: number): string {
  const due = new Date(expectedOn).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `Due ${due}, ${late === 1 ? "a day" : `${late} days`} late`;
}

/** The reminder, written and ready in the treasurer's mail app. */
export function reminderMailto(input: {
  to: string;
  contactName: string | null;
  orgName: string;
  amountCents: number;
  expectedOn: Date | string;
}): string {
  const due = new Date(input.expectedOn).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  const hello = input.contactName?.trim()
    ? `Hi ${input.contactName.trim().split(/\s+/)[0]},`
    : "Hi,";
  const subject = `${input.orgName} sponsorship invoice`;
  const body = [
    hello,
    "",
    `A quick reminder about our invoice for ${money(input.amountCents)}, which was due ${due}. Could you let us know when it will be paid?`,
    "",
    "Thank you for supporting us.",
  ].join("\n");
  return `mailto:${input.to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
