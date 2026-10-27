import type { RSVPStatus } from "@/generated/prisma/client";
import type { CalendarEventSummary } from "@/app/app/[orgSlug]/calendar/queries";
import { dayWordOfKey, dueLabel, whenWord } from "@/lib/overview/format";
import { arrangeUpNext, taskTone, type UpNextCandidate } from "@/lib/overview/up-next";
import { pollHref } from "@/lib/polls/paths";
import { addDaysToKey, dueDateKey, localDateKey } from "@/lib/tasks/dates";
import type { MyOpenTask } from "@/server/tasks/queries";

import type { EventGoing, PersonFace, PollStat, TaskExtras } from "./queries";

/**
 * The Up next blocks from what the Overview already read: the viewer's
 * tasks due within the week, meetings and events in the next seven days
 * (an RSVP still waiting on the viewer becomes an answer), and open polls
 * they haven't answered. Ordering: src/lib/overview/up-next.ts.
 */

export interface UpNextBlock extends UpNextCandidate {
  /** An event's type colour (EventTag.color), for the card's own fill. */
  accent?: string | null;
  kicker: string;
  title: string;
  subtitle: string | null;
  figure?: string;
  figureLabel?: string;
  faces: PersonFace[];
  facesTotal: number;
  href: string;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

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
  /** "{kind}:{id}" of the cards this member hid (UpNextDismissal). */
  hidden?: ReadonlySet<string>;
}) {
  const base = `/app/${input.orgSlug}`;
  const weekEnd = addDaysToKey(input.todayKey, 7);
  const blocks: UpNextBlock[] = [];

  for (const task of input.tasks) {
    if (!task.dueDate) continue;
    const dueKey = dueDateKey(task.dueDate);
    if (dueKey > weekEnd) continue;
    const extra = input.taskExtras.get(task.id);
    const due = dueLabel(dueKey, input.todayKey);
    const subs = extra?.subtasks;
    blocks.push({
      id: task.id,
      kind: "task",
      tone: taskTone(dueKey, input.todayKey),
      at: task.dueDate,
      kicker:
        due.tone === "danger"
          ? dueKey === input.todayKey
            ? "Due today"
            : due.text
          : `Due ${due.text === "Tomorrow" ? "tomorrow" : due.text}`,
      title: task.title,
      subtitle: task.parentTask ? `Part of ${task.parentTask.title}` : null,
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
      const when = whenWord(event.startsAt, event.allDay, input.zones, input.now);
      const waiting = rsvp === "PENDING";
      const count = going?.going ?? 0;
      blocks.push({
        id: event.id,
        kind: waiting ? "rsvp" : kind,
        tone: waiting ? "answer" : "quiet",
        accent: event.tag?.color ?? null,
        at: event.startsAt,
        kicker: waiting ? `Your RSVP · ${when}` : when,
        title: event.title,
        subtitle: event.location,
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

  for (const poll of input.polls) {
    if (poll.mine) continue;
    // A poll with no closing date used to be given a fake one 30 weeks out,
    // which meant it sat in Up next for the rest of the year. An open poll is
    // worth asking about for a fortnight; after that it is not "up next", and
    // it is still on Polls for anyone who wants it.
    const asked = poll.closesAt ?? addDays(poll.createdAt, OPEN_POLL_DAYS);
    if (asked.getTime() <= input.now.getTime()) continue;
    const closes = poll.closesAt
      ? ` · closes ${dayWordOfKey(localDateKey(poll.closesAt, input.zones.viewer), input.todayKey)}`
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
  if (block.kind === "task") return false;
  return block.at.getTime() <= now.getTime();
}
