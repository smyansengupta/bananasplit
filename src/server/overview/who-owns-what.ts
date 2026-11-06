import {
  buildPieces,
  type GroupedBy,
  type OwnTask,
  type OwnerFace,
  type Piece,
} from "@/lib/overview/ownership";
import type { ItemRef } from "@/lib/overview/types";
import { epicOf, epicParentsSelect } from "@/lib/tasks/epic";
import { daysBetweenKeys, dueDateKey, localDateKey } from "@/lib/tasks/dates";
import type { TxClient } from "@/server/db/context";
import { userPublicSelect } from "@/server/members";

import { linkedTo } from "./item-links";

/**
 * "Who owns what" (src/components/overview/who-owns-what.tsx): the next big
 * event in the coming three weeks, the one with the most tasks linked to it
 * (ItemLink, either way round, as a meeting's page reads them; only tasks
 * the viewer can see that aren't deleted count), and its work piece by
 * piece with each piece's owner (src/lib/overview/ownership.ts). The events
 * are the page's own read of what's coming up (live, unmerged), passed in.
 *
 * Who could take an empty seat: members who claimed something on the
 * event's bring list, then members going to it, leaving out anyone who
 * already owns a piece. Sign-ups and claims are read as the viewer (RLS: only
 * owners and admins see sign-ups), so a member may get fewer suggestions,
 * or none. Reads run one after another on the page's transaction.
 */

/** How far ahead the event may be. */
export const OWNERSHIP_DAYS = 21;
const MAX_TASKS = 60;
const MAX_SUGGESTIONS = 3;

export interface OwnershipSuggestion {
  face: OwnerFace;
  /** Why they're suggested: they claimed a bring list item, or they're going. */
  why: "claimed" | "going";
}

export interface WhoOwnsWhatData {
  event: { id: string; title: string; href: string; dayKey: string; daysOut: number };
  groupedBy: GroupedBy;
  pieces: Piece[];
  suggestions: OwnershipSuggestion[];
  /** Where the work lives: the event, and the tasks list for it. */
  links: ItemRef[];
}

export async function loadWhoOwnsWhat(
  db: TxClient,
  organizationId: string,
  orgSlug: string,
  {
    now,
    todayKey,
    timeZone,
    upcoming,
  }: {
    now: Date;
    todayKey: string;
    timeZone: string;
    /** What's coming up, soonest first (the page's getUpcomingEvents read). */
    upcoming: readonly { id: string; title: string; startsAt: Date }[];
  },
): Promise<WhoOwnsWhatData | null> {
  const base = `/app/${orgSlug}`;
  const until = new Date(now.getTime() + OWNERSHIP_DAYS * 24 * 60 * 60 * 1000);
  const events = upcoming.filter((e) => e.startsAt >= now && e.startsAt <= until).slice(0, 60);
  if (events.length === 0) return null;
  const linked = await linkedTo(
    db,
    organizationId,
    "event",
    events.map((e) => e.id),
    "task",
  );
  // Only links to tasks the viewer can see (RLS) and that aren't deleted count.
  const linkedIds = [...new Set([...linked.values()].flat())];
  const live = new Set(
    linkedIds.length
      ? (
          await db.task.findMany({
            where: { organizationId, id: { in: linkedIds }, deletedAt: null },
            select: { id: true },
            take: 2000,
          })
        ).map((t) => t.id)
      : [],
  );
  const tasksOf = new Map(
    [...linked].map(([eventId, ids]) => [eventId, ids.filter((id) => live.has(id))]),
  );
  // The most linked tasks wins; between equals, the soonest (events come in date order).
  let event: (typeof events)[number] | null = null;
  for (const e of events) {
    const n = tasksOf.get(e.id)?.length ?? 0;
    if (n > 0 && (!event || n > (tasksOf.get(event.id)?.length ?? 0))) event = e;
  }
  if (!event) return null;

  const rows = await db.task.findMany({
    where: { organizationId, id: { in: tasksOf.get(event.id)! }, deletedAt: null },
    select: {
      ...epicParentsSelect,
      status: true,
      dueDate: true,
      blockedReason: true,
      owner: { select: userPublicSelect },
    },
    orderBy: { createdAt: "asc" },
    take: MAX_TASKS,
  });
  if (rows.length === 0) return null;

  const tags = await db.taskLabel.findMany({
    where: { organizationId, taskId: { in: rows.map((t) => t.id) } },
    select: { taskId: true, label: { select: { id: true, name: true } } },
    take: 500,
  });

  const tasks: OwnTask[] = rows.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    dueKey: t.dueDate ? dueDateKey(t.dueDate) : null,
    blockedReason: t.blockedReason,
    owner: t.owner,
    epic: epicIn(t),
    labels: tags.filter((x) => x.taskId === t.id).map((x) => x.label),
  }));
  const { groupedBy, pieces } = buildPieces(tasks, { base, todayKey });

  const owners = new Set(tasks.flatMap((t) => (t.owner ? [t.owner.id] : [])));
  const seats = pieces.some((p) => p.unownedTaskIds.length > 0);
  const suggestions = seats ? await suggest(db, organizationId, event.id, owners) : [];

  const dayKey = localDateKey(event.startsAt, timeZone);
  const href = `${base}/calendar/${event.id}`;
  return {
    event: {
      id: event.id,
      title: event.title,
      href,
      dayKey,
      daysOut: daysBetweenKeys(todayKey, dayKey),
    },
    groupedBy,
    pieces,
    suggestions,
    links: [{ kind: "event", label: event.title, href }],
  };
}

/** The epic a task is in (its parent, or its story's parent), never the task itself. */
function epicIn(task: Parameters<typeof epicOf>[0]): { id: string; title: string } | null {
  const epic = epicOf(task);
  return epic && epic.id !== task.id ? { id: epic.id, title: epic.title } : null;
}

/** Members who claimed a bring list item, then members going; none who own a piece already. */
async function suggest(
  db: TxClient,
  organizationId: string,
  eventId: string,
  owners: ReadonlySet<string>,
): Promise<OwnershipSuggestion[]> {
  const claims = await db.rsvpItemClaim.findMany({
    where: { organizationId, item: { eventId } },
    select: { registration: { select: { userId: true } } },
    take: 200,
  });
  const going = await db.eventAttendee.findMany({
    where: { organizationId, eventId, rsvp: "YES" },
    select: { userId: true },
    take: 500,
  });
  const why = new Map<string, OwnershipSuggestion["why"]>();
  for (const c of claims) {
    const id = c.registration.userId;
    if (id && !owners.has(id)) why.set(id, "claimed");
  }
  for (const g of going) {
    if (!owners.has(g.userId) && !why.has(g.userId)) why.set(g.userId, "going");
  }
  if (why.size === 0) return [];
  // Only current members can own a task here.
  const members = await db.membership.findMany({
    where: { organizationId, userId: { in: [...why.keys()] } },
    select: { user: { select: userPublicSelect } },
  });
  const byId = new Map(members.map((m) => [m.user.id, m.user]));
  return [...why.entries()]
    .flatMap(([id, reason]) => {
      const face = byId.get(id);
      return face ? [{ face, why: reason }] : [];
    })
    .sort((a, b) => (a.why === b.why ? 0 : a.why === "claimed" ? -1 : 1))
    .slice(0, MAX_SUGGESTIONS);
}
