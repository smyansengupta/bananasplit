import { parseAvailability, type Availability } from "@/lib/availability";
import { focusWeek, localHours, spansOf, type FocusWeek } from "@/lib/overview/focus-time";
import type { ItemRef } from "@/lib/overview/types";
import { addDaysToKey, dueDateKey, localDateKey, zonedInstant } from "@/lib/tasks/dates";
import type { TxClient } from "@/server/db/context";

import type { DueTaskRow } from "./home-data";

/**
 * Focus time (src/components/overview/focus-time.tsx): the viewer's free
 * hours over the next seven days (src/lib/overview/focus-time.ts), from
 * their own availability (UserAvailability, owner-only) and the timed events
 * in this organization they host or said yes or maybe to. All-day events
 * don't take hours. Tasks have no time estimates, so the widget names the
 * next two open tasks due rather than claiming they fit (from the page's
 * own read of the viewer's due tasks, passed in).
 *
 * Reads run one after another on the page's transaction.
 */

const DAYS = 7;
const NEXT_TASKS = 2;
const PRIORITY_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

export interface FocusTask {
  id: string;
  title: string;
  href: string;
  dueKey: string;
}

export interface FocusTimeData {
  week: FocusWeek;
  todayKey: string;
  /** The viewer's availability as saved, so Block it off can add one date rule to it. */
  availability: Availability;
  tasks: FocusTask[];
  /** The profile page, where availability is edited. */
  availabilityHref: string;
  links: ItemRef[];
}

export async function loadFocusTime(
  db: TxClient,
  organizationId: string,
  orgSlug: string,
  {
    userId,
    now,
    timeZone,
    myDue,
  }: { userId: string; now: Date; timeZone: string; myDue: readonly DueTaskRow[] },
): Promise<FocusTimeData> {
  const base = `/app/${orgSlug}`;
  const todayKey = localDateKey(now, timeZone);
  const end = zonedInstant(addDaysToKey(todayKey, DAYS), 0, timeZone);

  const saved = await db.userAvailability.findUnique({
    where: { userId },
    select: { rules: true },
  });
  const availability = parseAvailability(saved?.rules);
  const events = await db.event.findMany({
    where: {
      organizationId,
      deletedAt: null,
      allDay: false,
      startsAt: { lt: end },
      endsAt: { gt: now },
      OR: [
        { hostUserId: userId },
        { attendees: { some: { userId, rsvp: { in: ["YES", "MAYBE"] } } } },
      ],
    },
    select: { startsAt: true, endsAt: true },
    take: 200,
  });
  const week = focusWeek({
    todayKey,
    nowHour: localHours(now, timeZone),
    availability,
    events: events.flatMap((e) => spansOf(e.startsAt, e.endsAt, timeZone)),
    days: DAYS,
  });

  // The next ones due from today on, the more urgent first on the same day.
  const tasks = myDue
    .flatMap((t) => (t.dueDate ? [{ ...t, dueKey: dueDateKey(t.dueDate) }] : []))
    .filter((t) => t.dueKey >= todayKey)
    .sort(
      (a, b) =>
        a.dueKey.localeCompare(b.dueKey) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
    )
    .slice(0, NEXT_TASKS)
    .map((t) => ({ id: t.id, title: t.title, href: `${base}/tasks/${t.id}`, dueKey: t.dueKey }));

  return {
    week,
    todayKey,
    availability,
    tasks,
    availabilityHref: `${base}/profile`,
    links: tasks.map((t) => ({ kind: "task", label: t.title, href: t.href })),
  };
}
