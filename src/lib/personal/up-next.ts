import { dueLabel, whenWord } from "@/lib/overview/format";
import { arrangeUpNext, type UpNextSlot } from "@/lib/overview/up-next";
import type { UpNextBlock } from "@/server/overview/up-next";
import type { PersonalHomeData } from "@/server/personal/home";

/**
 * The Personal home's Up next, across Personal and your clubs: your tasks
 * due within the week (due today or overdue is an alert), polls waiting on
 * you and RSVPs you haven't answered (answers), and what's on (quiet).
 * Same ordering rules as a club's Overview (src/lib/overview/up-next.ts).
 */
export function personalUpNext(data: PersonalHomeData, now: Date): UpNextSlot<UpNextBlock>[] {
  const blocks: UpNextBlock[] = [];
  for (const task of data.dueSoon) {
    const due = dueLabel(task.dueKey, data.todayKey);
    blocks.push({
      id: task.id,
      kind: "task",
      tone: task.bucket === "soon" ? "quiet" : "alert",
      at: new Date(`${task.dueKey}T12:00:00Z`),
      kicker:
        task.bucket === "today"
          ? "Due today"
          : task.bucket === "overdue"
            ? due.text
            : `Due ${due.text === "Tomorrow" ? "tomorrow" : due.text}`,
      title: task.title,
      subtitle: task.space.name,
      faces: [],
      facesTotal: 0,
      href: task.href,
    });
  }
  for (const event of data.upcoming) {
    const waiting = event.rsvp === "PENDING";
    const when = whenWord(
      event.startsAt,
      event.allDay,
      { viewer: data.timeZone, org: event.space.timeZone },
      now,
    );
    blocks.push({
      id: `${event.space.id}:${event.id}`,
      kind: waiting ? "rsvp" : "event",
      tone: waiting ? "answer" : "quiet",
      at: event.startsAt,
      kicker: when,
      title: event.title,
      subtitle: [event.space.name, event.location].filter(Boolean).join(", "),
      faces: [],
      facesTotal: 0,
      href: event.href,
    });
  }
  for (const poll of data.pollsWaiting) {
    blocks.push({
      id: `${poll.space.id}:${poll.id}`,
      kind: "poll",
      tone: "answer",
      at: poll.closesAt ?? new Date(now.getTime() + 365 * 24 * 3600 * 1000),
      kicker: poll.kind === "question" ? "Your vote" : "Your times",
      title: poll.title,
      subtitle: poll.space.name,
      faces: [],
      facesTotal: 0,
      href: poll.href,
    });
  }
  return arrangeUpNext(blocks);
}
