import { z } from "zod";

import { OrgKind, RegistrationStatus, Role, TaskStatus } from "@/generated/prisma/client";
import { ForbiddenError } from "@/lib/auth/errors";
import { writeOrgAuditLog } from "@/server/audit";
import { withOrgTx, withUserTx } from "@/server/db/context";
import { sqlStateOf } from "@/server/db/errors";

import { getPersonalSpace } from "./space";

/**
 * "Bring anything in?" (docs/features/personal-and-clubs.md, "Starting a
 * club"): the Personal items a club's creator can move into a club they run,
 * and the move itself. The move is app.move_personal_items
 * (20261013190000_move_personal_items), one transaction as app_user: the
 * database checks that the Personal space is the caller's and that they own
 * or run the club, then moves each item with every row under it, keeping
 * ids, so public links, tickets and poll responses keep working.
 *
 * Used by the last club setup step (/onboarding/organization/{slug}/bring)
 * and by "Move to a club" (/app/{personal slug}/move).
 */

/** The most of each kind listed (and moved) at once; the function caps the total at 500. */
const LIST_LIMIT = 100;

export interface BringableEvent {
  id: string;
  title: string;
  startsAt: Date;
  allDay: boolean;
  /** Has a public RSVP page (/e/{slug}). */
  rsvp: boolean;
  /** Going sign-ups on its RSVP page. */
  going: number;
  past: boolean;
}

export interface BringablePoll {
  id: string;
  title: string;
  kind: "availability" | "question";
  /** People who answered (availability) or votes cast (question). */
  responses: number;
  /** An availability poll's scheduled event: it moves with the poll. */
  finalizedEventId: string | null;
}

export interface BringableTask {
  id: string;
  title: string;
  dueDate: Date | null;
  /** Live subtasks: they move with it. */
  subtasks: number;
}

export interface BringableTaskGroup {
  /** A heading for the group (null: none; projects, which named them, became epics). */
  project: string | null;
  tasks: BringableTask[];
}

export interface Bringable {
  space: { id: string; slug: string; name: string; timezone: string };
  /** Events with an RSVP page. */
  rsvpEvents: BringableEvent[];
  /** Other calendar events: upcoming ones and the last month's. */
  events: BringableEvent[];
  polls: BringablePoll[];
  /** Open top-level tasks and epics. */
  taskGroups: BringableTaskGroup[];
  /** Every item listed. */
  total: number;
}

/** What the user's Personal space holds that could move into a club; null without a space. */
export async function loadBringable(userId: string, now = new Date()): Promise<Bringable | null> {
  const space = await getPersonalSpace(userId);
  if (!space || space.deletedAt) return null;
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  return withOrgTx(space.id, async ({ db }) => {
    const orgId = space.id;
    const [eventRows, pollRows, questionRows, taskRows] = await Promise.all([
      db.event.findMany({
        where: {
          organizationId: orgId,
          deletedAt: null,
          mergedIntoId: null,
          OR: [{ rsvpSlug: { not: null } }, { endsAt: { gte: monthAgo } }],
        },
        orderBy: { startsAt: "asc" },
        take: LIST_LIMIT * 2,
        select: {
          id: true,
          title: true,
          startsAt: true,
          endsAt: true,
          allDay: true,
          rsvpSlug: true,
          _count: { select: { registrations: { where: { status: RegistrationStatus.GOING } } } },
        },
      }),
      db.availabilityPoll.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "desc" },
        take: LIST_LIMIT,
        select: {
          id: true,
          title: true,
          finalizedEventId: true,
          responses: { select: { userId: true, guestName: true, guestKeyHash: true } },
        },
      }),
      db.poll.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "desc" },
        take: LIST_LIMIT,
        select: { id: true, question: true, _count: { select: { votes: true } } },
      }),
      db.task.findMany({
        where: {
          organizationId: orgId,
          deletedAt: null,
          parentTaskId: null,
          status: { not: TaskStatus.COMPLETED },
        },
        orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
        take: LIST_LIMIT,
        select: {
          id: true,
          title: true,
          dueDate: true,
          _count: { select: { subtasks: { where: { deletedAt: null } } } },
        },
      }),
    ]);

    const toEvent = (e: (typeof eventRows)[number]): BringableEvent => ({
      id: e.id,
      title: e.title,
      startsAt: e.startsAt,
      allDay: e.allDay,
      rsvp: e.rsvpSlug !== null,
      going: e._count.registrations,
      past: e.endsAt.getTime() < now.getTime(),
    });
    // Upcoming first (soonest first), then the past (latest first).
    const ordered = [
      ...eventRows.filter((e) => e.endsAt.getTime() >= now.getTime()),
      ...eventRows.filter((e) => e.endsAt.getTime() < now.getTime()).reverse(),
    ].map(toEvent);
    const rsvpEvents = ordered.filter((e) => e.rsvp).slice(0, LIST_LIMIT);
    const events = ordered.filter((e) => !e.rsvp).slice(0, LIST_LIMIT);

    const polls: BringablePoll[] = [
      ...pollRows.map((p) => ({
        id: p.id,
        title: p.title,
        kind: "availability" as const,
        responses: new Set(
          p.responses.map((r) => r.userId ?? r.guestKeyHash ?? `name:${r.guestName ?? ""}`),
        ).size,
        finalizedEventId: p.finalizedEventId,
      })),
      ...questionRows.map((p) => ({
        id: p.id,
        title: p.question,
        kind: "question" as const,
        responses: p._count.votes,
        finalizedEventId: null,
      })),
    ];

    // One group: an epic is a top-level item like any task (projects,
    // which used to group them, became epics).
    const taskGroups: BringableTaskGroup[] =
      taskRows.length > 0
        ? [
            {
              project: null,
              tasks: taskRows.map((t) => ({
                id: t.id,
                title: t.title,
                dueDate: t.dueDate,
                subtasks: t._count.subtasks,
              })),
            },
          ]
        : [];

    return {
      space: { id: space.id, slug: space.slug, name: space.name, timezone: space.timezone },
      rsvpEvents,
      events,
      polls,
      taskGroups,
      total: rsvpEvents.length + events.length + polls.length + taskRows.length,
    };
  });
}

/** Every id listed in a Bringable, for checking a ?bring= preselection. */
export function bringableIds(b: Bringable): Set<string> {
  return new Set([
    ...b.rsvpEvents.map((e) => e.id),
    ...b.events.map((e) => e.id),
    ...b.polls.map((p) => p.id),
    ...b.taskGroups.flatMap((g) => g.tasks.map((t) => t.id)),
  ]);
}

const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const ids = z.array(id).max(500).default([]);

export const moveSelectionSchema = z
  .object({ eventIds: ids, pollIds: ids, questionPollIds: ids, taskIds: ids })
  .strict();
export type MoveSelection = z.input<typeof moveSelectionSchema>;

export interface MovedCounts {
  events: number;
  polls: number;
  questionPolls: number;
  tasks: number;
}

export type MoveResult = { ok: true; moved: MovedCounts } | { ok: false; error: string };

/**
 * Moves the picked items from the user's Personal space into `toOrgId`, one
 * way (app.move_personal_items). A poll's scheduled event and a task's
 * subtasks come along. Refusals come back as `{ ok: false, error }`.
 */
export async function movePersonalItems(
  userId: string,
  toOrgId: string,
  input: unknown,
): Promise<MoveResult> {
  const parsed = moveSelectionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pick what to bring in, then try again." };
  const pick = parsed.data;
  const count =
    pick.eventIds.length + pick.pollIds.length + pick.questionPollIds.length + pick.taskIds.length;
  if (count === 0) return { ok: true, moved: { events: 0, polls: 0, questionPolls: 0, tasks: 0 } };
  if (count > 500) return { ok: false, error: "Bring in at most 500 things at once." };

  const space = await getPersonalSpace(userId);
  if (!space || space.deletedAt) return { ok: false, error: "Your Personal space wasn't found." };

  let moved: MovedCounts;
  try {
    moved = await withUserTx(userId, async ({ db }) => {
      const rows = await db.$queryRaw<{ r: MovedCounts }[]>`
        SELECT app.move_personal_items(
          ${space.id}, ${toOrgId},
          ${pick.eventIds}::text[], ${pick.pollIds}::text[],
          ${pick.questionPollIds}::text[], ${pick.taskIds}::text[]) AS r`;
      return rows[0].r;
    });
  } catch (error) {
    if (error instanceof ForbiddenError || sqlStateOf(error) === "42501") {
      return {
        ok: false,
        error:
          "You can bring things only into an organization you own or run, while it isn't paused.",
      };
    }
    if (sqlStateOf(error) === "22023") {
      return {
        ok: false,
        error: "Something you picked was moved or deleted. Refresh the page and try again.",
      };
    }
    if (sqlStateOf(error) === "55000") {
      return { ok: false, error: "An event with check-ins can't be moved." };
    }
    throw error;
  }

  // The club's history: what came in, from whose Personal space.
  await withOrgTx(toOrgId, ({ db }) =>
    writeOrgAuditLog(db, {
      organizationId: toOrgId,
      action: "personal.items_moved",
      targetType: "Organization",
      targetId: toOrgId,
      diff: { ...moved, fromPersonalSpace: space.id },
    }),
  );
  return { ok: true, moved };
}

/** "3 events, 1 poll and 2 tasks". */
export function movedSummary(m: MovedCounts): string {
  const n = (k: number, one: string, many: string) => (k === 1 ? `1 ${one}` : `${k} ${many}`);
  const parts = [
    m.events ? n(m.events, "event", "events") : null,
    m.polls + m.questionPolls ? n(m.polls + m.questionPolls, "poll", "polls") : null,
    m.tasks ? n(m.tasks, "task", "tasks") : null,
  ].filter((p): p is string => p !== null);
  if (parts.length <= 1) return parts[0] ?? "nothing";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export interface ClubYouRun {
  id: string;
  name: string;
  slug: string;
}

/** The live clubs where the user can bring things in: OWNER or ADMIN. */
export async function clubsUserRuns(userId: string): Promise<ClubYouRun[]> {
  return withUserTx(userId, async ({ db }) =>
    (
      await db.membership.findMany({
        where: {
          userId,
          role: { in: [Role.OWNER, Role.ADMIN] },
          organization: { kind: OrgKind.CLUB, deletedAt: null },
        },
        select: { organization: { select: { id: true, name: true, slug: true } } },
        orderBy: { organization: { name: "asc" } },
      })
    ).map((m) => m.organization),
  );
}
