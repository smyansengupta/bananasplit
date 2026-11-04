import { dueLabel, whenWord } from "@/lib/overview/format";
import type { UpNextBlock } from "@/server/overview/up-next";
import type { PersonalHomeData } from "@/server/personal/home";

/**
 * Personal Home's Up next, from your organizations: the cards
 * personalUpNext makes for every space but `exceptSpaceId` (the Personal
 * space itself, which Home reads in full), each carrying its organization
 * so Done, Push back and Going act there. Polls open on their page.
 */
export function otherSpacesUpNext(
  data: PersonalHomeData,
  now: Date,
  exceptSpaceId: string,
): UpNextBlock[] {
  const blocks: UpNextBlock[] = [];
  for (const task of data.dueSoon) {
    if (task.space.id === exceptSpaceId) continue;
    const due = dueLabel(task.dueKey, data.todayKey);
    blocks.push({
      id: task.id,
      orgId: task.space.id,
      kind: "task",
      taskStatus: task.status,
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
    if (event.space.id === exceptSpaceId) continue;
    const waiting = event.rsvp === "PENDING";
    blocks.push({
      id: event.id,
      orgId: event.space.id,
      kind: waiting ? "rsvp" : "event",
      tone: waiting ? "answer" : "quiet",
      at: event.startsAt,
      kicker: whenWord(
        event.startsAt,
        event.allDay,
        { viewer: data.timeZone, org: event.space.timeZone },
        now,
      ),
      title: event.title,
      subtitle: [event.space.name, event.location].filter(Boolean).join(", "),
      faces: [],
      facesTotal: 0,
      href: event.href,
    });
  }
  for (const poll of data.pollsWaiting) {
    if (poll.space.id === exceptSpaceId) continue;
    blocks.push({
      id: poll.id,
      orgId: poll.space.id,
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
  return blocks;
}
