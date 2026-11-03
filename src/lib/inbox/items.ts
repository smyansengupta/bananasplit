import {
  addDaysToKey,
  localDateKey,
  localHour,
  mondayOfKey,
  zonedInstant,
} from "@/lib/tasks/dates";

/**
 * The Inbox's items and the times it puts them off to. Pure, so the page,
 * the sidebar count and the actions agree on what a key is and when
 * "Tomorrow" starts.
 */

/** What an Inbox row is. Needs: invite, task, request, review. Updates: update. */
export const INBOX_KINDS = ["invite", "task", "request", "review", "update", "crm"] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

/** The kinds that need you (the Needs you list and the sidebar count). */
export const NEED_KINDS: readonly InboxKind[] = ["invite", "task", "request", "review", "crm"];

const KEY = /^(invite|task|request|review|update|crm):([A-Za-z0-9_-]{1,64})$/;

/** "task:abc", the key InboxItemState stores (the migration checks the same shape). */
export function inboxKey(kind: InboxKind, id: string): string {
  return `${kind}:${id}`;
}

export function parseInboxKey(value: unknown): { kind: InboxKind; id: string } | null {
  if (typeof value !== "string") return null;
  const m = KEY.exec(value);
  return m ? { kind: m[1] as InboxKind, id: m[2] } : null;
}

export const SNOOZE_CHOICES = ["later", "tomorrow", "week"] as const;
export type SnoozeChoice = (typeof SNOOZE_CHOICES)[number];

export const SNOOZE_LABEL: Record<SnoozeChoice, string> = {
  later: "Later today",
  tomorrow: "Tomorrow",
  week: "Next week",
};

/** The morning hour a snoozed item comes back at. */
const MORNING = 8;

/**
 * When a snooze ends, in the member's time zone: Later today is three hours
 * on (the next whole hour), or tomorrow morning when that would run past
 * 9 pm; Tomorrow is 8 am tomorrow; Next week is 8 am next Monday.
 */
export function snoozeUntil(choice: SnoozeChoice, now: Date, tz: string): Date {
  const today = localDateKey(now, tz);
  if (choice === "later") {
    const hour = localHour(now, tz);
    if (hour + 3 >= 21) return zonedInstant(addDaysToKey(today, 1), MORNING, tz);
    const at = new Date(now.getTime() + 3 * 3_600_000);
    at.setUTCMinutes(0, 0, 0);
    return at.getTime() <= now.getTime() ? new Date(at.getTime() + 3_600_000) : at;
  }
  if (choice === "tomorrow") return zonedInstant(addDaysToKey(today, 1), MORNING, tz);
  return zonedInstant(addDaysToKey(mondayOfKey(today), 7), MORNING, tz);
}

/** Where a row sits in the list. */
export type InboxGroup = "overdue" | "today" | "week" | "later" | "review" | "earlier";

export const GROUP_LABEL: Record<InboxGroup, string> = {
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  later: "Later",
  review: "To review",
  earlier: "Earlier",
};

/**
 * The group for something dated `key` (a local day): before today is
 * Overdue, today is Today, within the next 7 days is This week, then Later.
 */
export function groupForDay(key: string, todayKey: string): InboxGroup {
  if (key < todayKey) return "overdue";
  if (key === todayKey) return "today";
  if (key <= addDaysToKey(todayKey, 7)) return "week";
  return "later";
}

/** The group for an update by when it happened: Today, This week (7 days) or Earlier. */
export function groupForPast(at: Date, now: Date, tz: string): InboxGroup {
  const key = localDateKey(at, tz);
  const today = localDateKey(now, tz);
  if (key >= today) return "today";
  if (key > addDaysToKey(today, -7)) return "week";
  return "earlier";
}
