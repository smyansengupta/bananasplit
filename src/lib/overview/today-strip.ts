import { daysBetweenKeys, localDateKey } from "@/lib/tasks/dates";

import { dayWordOfKey, timeWord } from "./format";
import { plural } from "./text";

/**
 * The Today strip at the top of an organization's Overview: four counts,
 * each a link with one line under it. Pure, so its words and links are
 * unit-tested (src/components/overview/today-strip.test.tsx); the page
 * hands it what it already read.
 */

export interface TodayCell {
  key: "overdue" | "waiting" | "due" | "events";
  /** Null when the count couldn't be read. */
  value: number | null;
  label: string;
  sub: string;
  href: string;
  /** A short chip beside the number ("3 days late", "All clear"), or none. */
  chip?: { text: string; tone: "destructive" | "success" | "secondary" };
}

/** What the Inbox's Needs you is made of (sidebarCounts' needsYou). */
export interface NeedsYouParts {
  invites: number;
  tasks: number;
  requests: number;
  reviews: number;
  /** The CRM's rows: people to reach today and its Review suggestions. */
  crm?: number;
}

/** "2 approvals, 1 form to review", at most three parts, biggest asks first. */
function needsYouLine(parts: NeedsYouParts): string {
  const words = [
    parts.requests > 0 ? plural(parts.requests, "approval") : null,
    parts.reviews > 0 ? `${plural(parts.reviews, "form")} to review` : null,
    parts.invites > 0 ? `${plural(parts.invites, "invite")} to answer` : null,
    parts.tasks > 0 ? `${plural(parts.tasks, "task")} due` : null,
    parts.crm ? `${plural(parts.crm, "CRM follow-up")}` : null,
  ].filter((w): w is string => w !== null);
  return words.slice(0, 3).join(", ");
}

export function todayStrip(input: {
  /** "/app/{slug}" */
  base: string;
  todayKey: string;
  zones: { viewer: string; org: string };
  overdue: { count: number; first: { title: string; dueKey: string } | null };
  /** The sidebar's Inbox badge and its parts; null when that read failed. */
  waiting: { count: number; parts: NeedsYouParts } | null;
  dueThisWeek: { count: number; titles: readonly string[] };
  events: {
    count: number;
    days: number;
    next: { title: string; startsAt: Date; allDay: boolean } | null;
  };
}): TodayCell[] {
  const { base, todayKey, overdue, waiting, dueThisWeek, events } = input;
  const tasksHref = `${base}/tasks?scope=mine`;

  const late = overdue.first ? Math.max(1, daysBetweenKeys(overdue.first.dueKey, todayKey)) : 0;
  const next = events.next;
  const nextWhen = next
    ? (() => {
        const key = localDateKey(next.startsAt, next.allDay ? input.zones.org : input.zones.viewer);
        const day = dayWordOfKey(key, todayKey);
        return next.allDay
          ? `${day}, all day`
          : `${day} ${timeWord(next.startsAt, input.zones.viewer)}`;
      })()
    : null;

  return [
    {
      key: "overdue",
      value: overdue.count,
      label: "Overdue",
      sub:
        overdue.count > 0 && overdue.first
          ? `${overdue.first.title}, ${plural(late, "day")} late`
          : "Nothing late",
      href: overdue.count > 0 ? `${tasksHref}&overdue=1` : tasksHref,
      chip:
        overdue.count > 0
          ? { text: `${plural(late, "day")} late`, tone: "destructive" }
          : { text: "All clear", tone: "success" },
    },
    {
      key: "waiting",
      value: waiting?.count ?? null,
      label: "Waiting on you",
      sub: !waiting
        ? "What needs you, in your Inbox"
        : waiting.count === 0
          ? "Nothing needs you"
          : needsYouLine(waiting.parts) || "What needs you, in your Inbox",
      href: `${base}/inbox`,
      chip:
        waiting && waiting.count > 0 && needsYouLine(waiting.parts)
          ? { text: needsYouLine(waiting.parts).split(", ")[0]!, tone: "secondary" }
          : undefined,
    },
    {
      key: "due",
      value: dueThisWeek.count,
      label: "Due this week",
      sub:
        dueThisWeek.count > 0 && dueThisWeek.titles.length > 0
          ? dueThisWeek.titles.slice(0, 2).join(", ")
          : "Nothing due in the next 7 days",
      href: tasksHref,
    },
    {
      key: "events",
      value: events.count,
      label: `Events, next ${events.days} days`,
      sub: next && nextWhen ? `Next: ${next.title}, ${nextWhen}` : "Nothing on the calendar",
      href: `${base}/calendar`,
      // When the next one starts; the sub line names it.
      chip: nextWhen ? { text: nextWhen, tone: "secondary" } : undefined,
    },
  ];
}
