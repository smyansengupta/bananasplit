import type { PollListItem } from "@/components/polls/poll-list";
import { safeTimeZone } from "@/lib/calendar/dates";
import { availabilityExpiresAt } from "@/lib/polls/expiry";
import { pollHref } from "@/lib/polls/paths";
import { isPollOpen } from "@/lib/polls/question-poll";
import type { QuestionPollSummary } from "@/server/polls/question-polls";

import type { getOrgPolls } from "../queries";

/**
 * The rows of the two poll lists (Polls: questions; Find a time:
 * availability polls), labelled on the server in the poll's or the organization's
 * zone.
 */

export type AvailabilityRow = Awaited<ReturnType<typeof getOrgPolls>>[number];

function people(n: number, verb: string): string {
  if (n === 0) return verb === "voted" ? "No votes yet" : "No responses yet";
  return n === 1 ? `1 person ${verb}` : `${n} people ${verb}`;
}

function shortDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(at);
}

export function questionItem(
  poll: QuestionPollSummary,
  base: string,
  now: Date,
  timeZone: string,
  canDelete: boolean,
): PollListItem {
  const open = isPollOpen(poll, now);
  return {
    id: poll.id,
    kind: "question",
    title: poll.question,
    href: pollHref(base, "question", poll.id),
    status: open
      ? {
          tone: "open",
          label: poll.closesAt ? `Open until ${shortDate(poll.closesAt, timeZone)}` : "Open",
        }
      : { tone: "closed", label: "Closed" },
    meta: [
      `${poll.optionCount} options`,
      poll.multiple ? "Pick any" : null,
      poll.anonymous ? "Anonymous" : null,
      people(poll.voterCount, "voted"),
    ]
      .filter(Boolean)
      .join(" · "),
    canDelete,
  };
}

export function availabilityOpen(poll: AvailabilityRow, now: Date): boolean {
  return !poll.finalizedEventId && !(poll.closesAt && poll.closesAt.getTime() < now.getTime());
}

export function availabilityItem(
  poll: AvailabilityRow,
  base: string,
  now: Date,
  canDelete: boolean,
): PollListItem {
  const zone = safeTimeZone(poll.timezone);
  const status: PollListItem["status"] = poll.finalizedEventId
    ? {
        tone: "scheduled",
        label: poll.finalizedEvent
          ? `Scheduled ${shortDate(poll.finalizedEvent.startsAt, zone)}`
          : "Scheduled",
      }
    : availabilityOpen(poll, now)
      ? {
          tone: "open",
          label: poll.closesAt ? `Open until ${shortDate(poll.closesAt, zone)}` : "Open",
        }
      : { tone: "closed", label: "Closed" };
  return {
    id: poll.id,
    kind: "availability",
    title: poll.title,
    href: pollHref(base, "availability", poll.id),
    takesGuests: status.tone === "open",
    status,
    meta: [
      dateSpan(poll),
      `${poll.durationMinutes}-minute meeting`,
      people(poll.respondentCount, "responded"),
      // It deletes itself 10 days after the last day it offers (src/lib/polls/expiry.ts).
      poll.lastSlotEndsAt
        ? `Deletes ${shortDate(availabilityExpiresAt(poll.lastSlotEndsAt), zone)}`
        : null,
    ]
      .filter(Boolean)
      .join(" · "),
    canDelete,
    deleteNote: poll.finalizedEventId ? "The event it scheduled stays on the calendar." : undefined,
  };
}

/** "Sep 29 – Oct 3" in the poll's own zone, the days it offers. */
export function dateSpan(poll: AvailabilityRow): string | null {
  if (!poll.firstSlotAt || !poll.lastSlotEndsAt) return null;
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: safeTimeZone(poll.timezone),
  });
  // The last slot's end, less a minute, so a window ending at midnight stays on its day.
  const last = new Date(poll.lastSlotEndsAt.getTime() - 60_000);
  return fmt.formatRange(poll.firstSlotAt, last);
}
