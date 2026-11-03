import type { ItemRef } from "@/lib/overview/types";
import type { EventKind, RSVPStatus, TaskStatus } from "@/generated/prisma/client";
import type { CalendarEventSummary } from "@/app/app/[orgSlug]/calendar/queries";
import { dayWordOfKey, dueLabel, whenWord } from "@/lib/overview/format";
import { agendaItems } from "@/lib/overview/insights";
import { arrangeUpNext, taskTone, type UpNextCandidate } from "@/lib/overview/up-next";
import { pollHref } from "@/lib/polls/paths";
import { addDaysToKey, dueDateKey, localDateKey } from "@/lib/tasks/dates";
import type { MyOpenTask } from "@/server/tasks/queries";

import {
  type EventDetail,
  type EventGoing,
  type LinkedChip,
  type PersonFace,
  type PollStat,
  type TaskExtras,
} from "./queries";

/**
 * The Up next blocks from what the Overview already read: the viewer's
 * tasks due within the week, meetings and events in the next seven days
 * (an RSVP still waiting on the viewer becomes an answer), and open polls
 * they haven't answered. Ordering: src/lib/overview/up-next.ts.
 *
 * Each card says why it matters in one line (what blocks a task, which
 * event it's for; a meeting's agenda and the action items still open from
 * the last one; seats taken against the room), from `context` when the page
 * read it, and carries chips for what it's linked to.
 */

/** Open action items from the last meeting in an upcoming meeting's series. */
export interface LastMeetingActions {
  open: number;
  total: number;
  /** The last meeting's page. */
  href: string;
}

export interface UpNextContext {
  /** What each task and event is linked to, keyed "task:id" and "event:id". */
  links?: ReadonlyMap<string, readonly LinkedChip[]>;
  /** Agenda, series and notes of meetings and events, by event id. */
  details?: ReadonlyMap<string, EventDetail>;
  /** By upcoming meeting id. */
  lastActions?: ReadonlyMap<string, LastMeetingActions>;
  /** Seats taken on an event's RSVP page, where the viewer may see the count. */
  seats?: ReadonlyMap<string, number>;
}

/** At most this many chips on a card: it's a card, not the Linked panel. */
const CARD_CHIPS = 3;

/** An event's moment on Up next: about to start, or under way. */
export type UpNextLive = "soon" | "now";

export interface UpNextBlock extends UpNextCandidate {
  /** Starting within a quarter of an hour ("soon") or under way ("now"): the card goes live. */
  live?: UpNextLive;
  /** When a meeting or event ends; it stays on Up next until then. */
  until?: Date;
  /** A meeting or event that ended in the last two hours (notes, photos, thanks). */
  ended?: boolean;
  /** The event's kind, so its card can take that kind's colour. */
  eventKind?: EventKind | null;
  /** A task's status now, so Done on the card can be undone back to it. */
  taskStatus?: TaskStatus;
  kicker: string;
  title: string;
  subtitle: string | null;
  figure?: string;
  figureLabel?: string;
  faces: PersonFace[];
  facesTotal: number;
  href: string;
  /** A one-choice poll's options, answered right on the card. */
  choices?: { id: string; label: string }[];
  /** What it's linked to, as chips. */
  chips?: ItemRef[];
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
/** A meeting or event counts down for its last hour, and goes live for the last quarter. */
const COUNTDOWN_MIN = 60;
const LIVE_MIN = 15;
/** How long a meeting or event stays on Up next after it ends. */
export const JUST_ENDED_MS = 2 * 60 * 60 * 1000;

export function buildUpNext(input: {
  orgSlug: string;
  now: Date;
  todayKey: string;
  zones: { viewer: string; org: string };
  tasks: readonly MyOpenTask[];
  taskExtras: ReadonlyMap<string, TaskExtras>;
  meetings: readonly CalendarEventSummary[];
  events: readonly CalendarEventSummary[];
  rsvps: ReadonlyMap<string, RSVPStatus>;
  going: ReadonlyMap<string, EventGoing>;
  polls: readonly PollStat[];
  /** Meetings and events that ended in the last JUST_ENDED_MS (getRecentlyEnded). */
  ended?: readonly CalendarEventSummary[];
  /** "{kind}:{id}" of the cards this member hid (UpNextDismissal). */
  hidden?: ReadonlySet<string>;
  context?: UpNextContext;
}) {
  const base = `/app/${input.orgSlug}`;
  const weekEnd = addDaysToKey(input.todayKey, 7);
  const blocks: UpNextBlock[] = [];
  const ctx = input.context ?? {};
  const linked = (key: string) => [...(ctx.links?.get(key) ?? [])];
  const chipsOf = (list: readonly ItemRef[]) =>
    list.slice(0, CARD_CHIPS).map(({ kind, label, href }) => ({ kind, label, href }));
  // The week's meetings and events by day, for "Lands on Fall Social day".
  const calendar = [...input.events, ...input.meetings].filter(
    (e) => e.startsAt.getTime() - input.now.getTime() <= WEEK_MS,
  );
  const dayOf = (e: CalendarEventSummary) =>
    localDateKey(e.startsAt, e.allDay ? input.zones.org : input.zones.viewer);
  const whenOf = (e: CalendarEventSummary) =>
    whenWord(e.startsAt, e.allDay, input.zones, input.now).replace(/^(Today|Tomorrow)/, (w) =>
      w.toLowerCase(),
    );

  for (const task of input.tasks) {
    if (!task.dueDate) continue;
    const dueKey = dueDateKey(task.dueDate);
    if (dueKey > weekEnd) continue;
    const extra = input.taskExtras.get(task.id);
    const due = dueLabel(dueKey, input.todayKey);
    const subs = extra?.subtasks;
    const links = linked(`task:${task.id}`);
    // Why it matters: what's blocking it, the event it's for, or the event it lands on.
    const forEvent = links.find(
      (c) => c.ref.kind === "event" && calendar.some((e) => e.id === c.ref.id),
    );
    const sameDay = calendar.find((e) => dayOf(e) === dueKey);
    const why =
      task.status === "BLOCKED" && task.blockedReason
        ? `Blocked: ${task.blockedReason}`
        : forEvent
          ? `For ${forEvent.label}, ${whenOf(calendar.find((e) => e.id === forEvent.ref.id)!)}.`
          : sameDay
            ? `Due the day of ${sameDay.title}.`
            : null;
    blocks.push({
      id: task.id,
      kind: "task",
      taskStatus: task.status,
      tone: taskTone(dueKey, input.todayKey),
      at: task.dueDate,
      kicker:
        due.tone === "danger"
          ? dueKey === input.todayKey
            ? "Due today"
            : due.text
          : `Due ${due.text === "Tomorrow" ? "tomorrow" : due.text}`,
      title: task.title,
      subtitle: why ?? (task.parentTask ? `Part of ${task.parentTask.title}` : null),
      chips: chipsOf(links),
      ...(subs && subs.total > 0
        ? { figure: `${subs.done} of ${subs.total}`, figureLabel: "subtasks done" }
        : {}),
      faces: extra?.people ?? [],
      facesTotal: extra?.people.length ?? 0,
      href: `${base}/tasks/${task.id}`,
    });
  }

  const seen = new Set<string>();
  for (const [kind, list] of [
    ["meeting", input.meetings],
    ["event", input.events],
  ] as const) {
    for (const event of list) {
      if (seen.has(event.id) || event.startsAt.getTime() - input.now.getTime() > WEEK_MS) continue;
      seen.add(event.id);
      const rsvp = input.rsvps.get(event.id) ?? null;
      const going = input.going.get(event.id);
      const mins = Math.round((event.startsAt.getTime() - input.now.getTime()) / MINUTE_MS);
      const underWay = !event.allDay && mins <= 0 && event.endsAt.getTime() > input.now.getTime();
      const live: UpNextLive | undefined = event.allDay
        ? undefined
        : underWay
          ? "now"
          : mins <= LIVE_MIN
            ? "soon"
            : undefined;
      const when = underWay
        ? "Happening now"
        : !event.allDay && mins > 0 && mins <= COUNTDOWN_MIN
          ? `In ${mins} min`
          : whenWord(event.startsAt, event.allDay, input.zones, input.now);
      const waiting = rsvp === "PENDING";
      const count = going?.going ?? 0;
      const detail = ctx.details?.get(event.id);
      const chips: ItemRef[] = (detail?.notes ?? []).map((n) => ({
        kind: "note" as const,
        label: n.title,
        href: `${base}/notes/${n.id}`,
      }));
      const reasons: string[] = [];
      if (kind === "meeting") {
        const items = agendaItems(detail?.description ?? null);
        if (detail)
          reasons.push(
            items.length > 0
              ? `${items.length} agenda ${items.length === 1 ? "item" : "items"}.`
              : "No agenda yet.",
          );
        const last = ctx.lastActions?.get(event.id);
        if (last && last.open > 0) {
          reasons.push(
            `${last.open} action ${last.open === 1 ? "item" : "items"} from last time ${last.open === 1 ? "is" : "are"} still open.`,
          );
          chips.push({ kind: "task", label: `${last.open} open actions`, href: last.href });
        }
      } else {
        const seats = ctx.seats?.get(event.id);
        if (seats !== undefined && detail?.capacity)
          reasons.push(`${seats} of ${detail.capacity} seats taken.`);
      }
      // Its linked tasks are its own business; Up next shows the rest.
      chips.push(...linked(`event:${event.id}`).filter((c) => c.ref.kind !== "task"));
      blocks.push({
        id: event.id,
        kind: waiting ? "rsvp" : kind,
        tone: waiting ? "answer" : "quiet",
        eventKind: event.kind,
        at: event.startsAt,
        until: event.endsAt,
        ...(live ? { live } : {}),
        kicker: event.location ? `${when}, ${event.location}` : when,
        title: event.title,
        subtitle: reasons.length > 0 ? reasons.join(" ") : null,
        chips: chipsOf(chips),
        ...(count > 0
          ? {
              figure: String(count),
              figureLabel: rsvp === "YES" ? "going, including you" : "going",
            }
          : {}),
        faces: going?.faces ?? [],
        facesTotal: count,
        href: `${base}/calendar/${event.id}`,
      });
    }
  }

  // Just ended: for two hours, the notes and action items (a meeting) or
  // photos and thanks (an event), while it's fresh.
  for (const event of input.ended ?? []) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    const meeting = input.meetings.some((m) => m.id === event.id) || isMeeting(event);
    const count = input.going.get(event.id)?.going ?? 0;
    blocks.push({
      id: event.id,
      kind: meeting ? "meeting" : "event",
      tone: "quiet",
      eventKind: event.kind,
      at: event.endsAt,
      until: event.endsAt,
      ended: true,
      kicker: "Just ended",
      title: event.title,
      subtitle: meeting
        ? "Add the notes and action items while it's fresh."
        : "Add notes or photos while it's fresh.",
      ...(count > 0 ? { figure: String(count), figureLabel: "went" } : {}),
      faces: input.going.get(event.id)?.faces ?? [],
      facesTotal: count,
      href: meeting ? `${base}/meetings/${event.id}` : `${base}/calendar/${event.id}`,
    });
  }

  for (const poll of input.polls) {
    if (poll.mine) continue;
    // A poll with no closing date used to be given a fake one 30 weeks out,
    // which meant it sat in Up next for the rest of the year. An open poll is
    // worth asking about for a fortnight; after that it is not "up next", and
    // it is still on Polls for anyone who wants it.
    const asked = poll.closesAt ?? addDays(poll.createdAt, OPEN_POLL_DAYS);
    if (asked.getTime() <= input.now.getTime()) continue;
    const closes = poll.closesAt
      ? `, closes ${dayWordOfKey(localDateKey(poll.closesAt, input.zones.viewer), input.todayKey)}`
      : "";
    blocks.push({
      id: poll.id,
      kind: "poll",
      tone: "answer",
      at: asked,
      kicker: `${poll.kind === "question" ? "Your vote" : "Your times"}${closes}`,
      title: poll.title,
      subtitle: poll.kind === "question" ? "Poll" : "Find a time",
      figure: `${poll.voters} of ${poll.eligible}`,
      figureLabel: poll.kind === "question" ? "voted" : "answered",
      faces: poll.faces,
      facesTotal: poll.voters,
      href: pollHref(base, poll.kind, poll.id),
      ...(poll.choices ? { choices: poll.choices } : {}),
    });
  }

  // Nothing that has already happened. Each kind has its own reason to have
  // slipped through (an event that ran, a poll that closed, a task whose due
  // date passed while it stayed open), and the one rule covers all of them.
  const live = blocks.filter((b) => !isPast(b, input.now));
  const hidden = input.hidden ?? new Set<string>();
  return arrangeUpNext(live.filter((b) => !hidden.has(`${b.kind}:${b.id}`)));
}

/** How long an open poll with no closing date stays in Up next. */
const OPEN_POLL_DAYS = 14;

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Whether a block is about something that has already been and gone.
 *
 * An overdue task is NOT past: its whole point is that it still needs doing.
 * An event that has finished, or a poll whose moment has passed, is.
 */
function isPast(block: UpNextBlock, now: Date): boolean {
  if (block.kind === "task" || block.ended) return false;
  // A meeting or event stays until it ends; a poll until it closes.
  return (block.until ?? block.at).getTime() <= now.getTime();
}

/** A meeting as the Overview lists them (getUpcomingEvents): a board meeting, or "... meeting". */
function isMeeting(event: CalendarEventSummary): boolean {
  return event.kind === "BOARD_MEETING" || /meeting/i.test(event.title);
}
