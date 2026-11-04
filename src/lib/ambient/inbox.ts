import { addDaysToKey, mondayOfKey } from "@/lib/tasks/dates";

/**
 * When the Inbox's ambient buttons show (Buttons canvas, Inbox). Pure, so
 * the page decides and the tests pin it: Approve and Decline on a request,
 * Approve all on a run of small ones, Reply on a mention left a day, Going
 * and Can't go on an unanswered invite, Review on a form's new answers,
 * Snooze to Monday on what can wait, and the recap at the end of the week.
 */

const DAY = 86_400_000;

/** "Small": a reimbursement a treasurer can wave through. */
export const SMALL_REQUEST_CENTS = 5_000;
/** How many small ones make it worth one button for all of them. */
export const SMALL_BATCH_MIN = 3;

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/** "three", or the figure past nine. */
export function countWord(n: number): string {
  return WORDS[n] ?? String(n);
}

function days(from: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / DAY));
}

export interface RequestFacts {
  id: string;
  amountCents: number;
  /** How many receipts are attached. */
  receipts: number;
  createdAt: Date;
}

/**
 * Approve all: three or more requests under $50, each with a receipt.
 * The ids to approve and the reason, or null.
 */
export function smallBatch(
  requests: readonly RequestFacts[],
): { ids: string[]; label: string; reason: string } | null {
  const small = requests.filter((r) => r.amountCents < SMALL_REQUEST_CENTS && r.receipts > 0);
  if (small.length < SMALL_BATCH_MIN) return null;
  const n = small.length;
  return {
    ids: small.map((r) => r.id),
    label: `Approve all ${n}`,
    reason: `All ${countWord(n)} are under $50 and have receipts`,
  };
}

/** The headline over Approve all: "3 reimbursements under $50 are waiting". */
export function smallBatchTitle(n: number): string {
  return `${n} reimbursements under $50 are waiting`;
}

/** Why Approve and Decline are on a request: how long it has waited, and the receipt. */
export function requestReason(r: Pick<RequestFacts, "receipts" | "createdAt">, now: Date): string {
  const d = days(r.createdAt, now);
  const waited = d === 0 ? "Sent today" : d === 1 ? "Waiting a day" : `Waiting ${d} days`;
  return `${waited}, ${r.receipts > 0 ? "has a receipt" : "no receipt"}`;
}

/** A mention counts as left unanswered from this many hours on. */
export const MENTION_WAIT_HOURS = 20;

/** Reply shows up on a mention that has sat about a day. */
export function mentionWaiting(at: Date, now: Date): boolean {
  return now.getTime() - at.getTime() >= MENTION_WAIT_HOURS * 3_600_000;
}

/** "Kristine mentioned you a day ago". */
export function mentionReason(who: string | null | undefined, at: Date, now: Date): string {
  const d = Math.max(1, days(at, now));
  const when = d === 1 ? "a day ago" : `${d} days ago`;
  return `${who?.trim().split(/\s+/)[0] || "Someone"} mentioned you ${when}`;
}

/** A few short replies, sent in one click. */
export const SUGGESTED_REPLIES = ["Yes, go for it", "Let's talk at the sync", "On it"] as const;

/** Why Going and Can't go are on an invite: when it is, and that you haven't said. */
export function inviteReason(dayKey: string, todayKey: string): string {
  const when =
    dayKey === todayKey
      ? "Today"
      : dayKey === addDaysToKey(todayKey, 1)
        ? "Tomorrow"
        : dayKey <= addDaysToKey(todayKey, 6)
          ? "This week"
          : "Coming up";
  return `${when}, you haven't answered`;
}

/** Review shows the count: "Review 12". */
export function reviewAction(count: number): { label: string; reason: string } | null {
  if (count <= 0) return null;
  return {
    label: `Review ${count}`,
    reason: count === 1 ? "1 new answer to review" : `${count} new answers to review`,
  };
}

/** The Monday a snooze to Monday comes back on (next week's, never today). */
export function nextMondayKey(todayKey: string): string {
  return addDaysToKey(mondayOfKey(todayKey), 7);
}

/**
 * Snooze to Monday: for a row that can wait. Not something urgent, and
 * when it has a day of its own (a task's due date, an invite's event), not
 * one that comes before Monday.
 */
export function canWaitTillMonday(
  row: { urgent?: boolean; dayKey?: string | null },
  todayKey: string,
): boolean {
  if (row.urgent) return false;
  return !row.dayKey || row.dayKey >= nextMondayKey(todayKey);
}

/** The recap's button: in the end-of-week window, while nothing has gone out since it opened. */
export function recapIsDue(windowStart: Date | null, postedSince: number): boolean {
  return windowStart !== null && postedSince === 0;
}
