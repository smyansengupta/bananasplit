import { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import { can } from "@/lib/auth/permissions";
import { countsTowardBalance } from "@/lib/finance/stats";
import { epicOf } from "@/lib/tasks/epic";
import { addDaysToKey, localDateKey, zonedInstant } from "@/lib/tasks/dates";
import type { TxClient } from "@/server/db/context";

import { linkedTo } from "./item-links";
import { buildRecapWeek, type RecapFacts, type RecapWeek } from "./recap-week-text";

/**
 * The week, recapped (Overview): the last seven whole days in the viewer's
 * timezone, counted as the member (RLS bounds every read to what they can
 * see), against the seven days before. Money only for finance roles. One
 * query after another on the page's transaction, each bounded.
 *
 * The "organization" audience is the recap as an announcement: what every
 * member may read, whoever posts it. Pass role MEMBER with it (no money,
 * none of the sign-up counts only admins read), and it also leaves out
 * private tasks and notes the poster happens to see, and the RSVP count of
 * an event whose page hides it.
 */

const DAY_MS = 86_400_000;
/** How many weeks back "the busiest week since ..." looks. */
const HISTORY_WEEKS = 12;
const OPEN = ["NOT_STARTED", "IN_PROGRESS", "BLOCKED"] as const;
/** A reimbursement waiting longer than this is stuck. */
const STUCK_DAYS = 10;
/** A task blocked at least this long is stuck. */
const LONG_BLOCKED_DAYS = 7;

export interface RecapWeekInput {
  orgId: string;
  orgSlug: string;
  userId: string;
  role: Role;
  timeZone: string;
  now: Date;
  /** "viewer" (the default): the viewer's own recap. "organization": see above. */
  audience?: "viewer" | "organization";
}

export async function loadRecapWeek(db: TxClient, input: RecapWeekInput): Promise<RecapWeek> {
  return buildRecapWeek(await loadRecapFacts(db, input));
}

export async function loadRecapFacts(db: TxClient, input: RecapWeekInput): Promise<RecapFacts> {
  const { orgId: organizationId, timeZone: tz, now } = input;
  const base = `/app/${input.orgSlug}`;
  const everyone = input.audience === "organization";
  const isAdmin = !everyone && can({ role: input.role }, "settings.view");
  const seesMoney = !everyone && can({ role: input.role }, "finance.manage");
  // What every member can open: shared tasks and notes, never private ones.
  const taskSeen = everyone ? { visibility: "ORG" as const } : {};
  const noteSeen = everyone ? { visibility: "ORGANIZATION" as const } : {};
  const todayKey = localDateKey(now, tz);
  const at = (days: number) => zonedInstant(addDaysToKey(todayKey, days), 0, tz);
  const from = at(-7);
  const to = at(0);
  const prevFrom = at(-14);
  const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const dayOf = (offset: number) =>
    day.format(new Date(`${addDaysToKey(todayKey, offset)}T00:00:00Z`));

  // Tasks finished, week by week for the last twelve (this week first),
  // counted in one grouped read: width_bucket puts each completion between
  // the week boundaries (oldest first; timestamps are stored as UTC).
  const bounds = Array.from({ length: HISTORY_WEEKS + 1 }, (_, i) =>
    at(-7 * (HISTORY_WEEKS - i)).toISOString(),
  );
  const buckets = await db.$queryRaw<{ bucket: number; n: number }[]>`
    SELECT width_bucket(t."completedAt", ${bounds}::timestamp(3)[])::int AS bucket,
           count(*)::int AS n
      FROM "Task" t
     WHERE t."organizationId" = ${organizationId}
       AND t."deletedAt" IS NULL
       AND t."status" = 'COMPLETED'
       AND t."completedAt" >= ${bounds[0]}::timestamp(3)
       AND t."completedAt" < ${bounds[HISTORY_WEEKS]}::timestamp(3)
       ${everyone ? Prisma.sql`AND t."visibility" = 'ORG'` : Prisma.empty}
     GROUP BY 1`;
  const weekly = Array.from(
    { length: HISTORY_WEEKS },
    (_, i) => buckets.find((b) => b.bucket === HISTORY_WEEKS - i)?.n ?? 0,
  );
  const weekStarts = Array.from({ length: HISTORY_WEEKS }, (_, i) => dayOf(-7 * (i + 1)));

  // This week's finished tasks, with their epic.
  const doneRows = await db.task.findMany({
    where: {
      organizationId,
      deletedAt: null,
      ...taskSeen,
      status: "COMPLETED",
      completedAt: { gte: from, lt: to },
    },
    select: {
      id: true,
      title: true,
      type: true,
      color: true,
      parentTask: {
        select: {
          id: true,
          title: true,
          type: true,
          color: true,
          parentTask: { select: { id: true, title: true, type: true, color: true } },
        },
      },
    },
    take: 500,
  });
  const byEpic = new Map<string, { id: string; title: string; count: number }>();
  for (const t of doneRows) {
    const epic = epicOf(t);
    if (!epic || epic.id === t.id) continue;
    const slot = byEpic.get(epic.id) ?? { id: epic.id, title: epic.title, count: 0 };
    slot.count += 1;
    byEpic.set(epic.id, slot);
  }
  const topEpic = [...byEpic.values()].sort((a, b) => b.count - a.count)[0] ?? null;

  // New members.
  const joinedRows = await db.membership.findMany({
    where: { organizationId, joinedAt: { gte: from, lt: to } },
    select: { user: { select: { id: true, name: true } } },
    orderBy: { joinedAt: "asc" },
    take: 50,
  });
  const joinedBefore = await db.membership.count({
    where: { organizationId, joinedAt: { gte: prevFrom, lt: from } },
  });

  // Events held this week, and the last one anyone checked in to.
  const held = await db.event.findMany({
    where: { organizationId, deletedAt: null, mergedIntoId: null, startsAt: { gte: from, lt: to } },
    select: {
      id: true,
      title: true,
      kind: true,
      startsAt: true,
      attendanceCount: true,
      rsvpEnabled: true,
      rsvpHideCount: true,
    },
    orderBy: { startsAt: "desc" },
    take: 100,
  });
  // A meeting as the Overview tells them apart (getUpcomingEvents).
  const isMeeting = (e: { kind: string; title: string }) =>
    e.kind === "BOARD_MEETING" || /meeting/i.test(e.title);
  const checkedIn = held.find((e) => e.attendanceCount > 0) ?? null;
  let lastEvent: RecapFacts["lastEvent"] = null;
  if (checkedIn) {
    // RSVPs: the sign-up page's guests (admins only can read those), else
    // the members who said yes.
    let rsvps: number | null = null;
    if (everyone && checkedIn.rsvpHideCount) {
      // Its page doesn't say how many are going; the post doesn't either.
      rsvps = null;
    } else if (checkedIn.rsvpEnabled) {
      rsvps = isAdmin
        ? await db.eventRegistration.count({
            where: { organizationId, eventId: checkedIn.id, status: "GOING" },
          })
        : null;
    } else {
      const yes = await db.eventAttendee.count({
        where: { organizationId, eventId: checkedIn.id, rsvp: "YES" },
      });
      rsvps = yes > 0 ? yes : null;
    }
    lastEvent = {
      id: checkedIn.id,
      title: checkedIn.title,
      checkedIn: checkedIn.attendanceCount,
      rsvps,
    };
  }

  // Money out, for finance roles.
  let money: RecapFacts["money"] = null;
  let waiting: RecapFacts["waiting"] = null;
  if (seesMoney) {
    const moved = await db.transaction.findMany({
      where: {
        organizationId,
        voidedAt: null,
        direction: "OUT",
        occurredAt: { gte: prevFrom, lt: to },
      },
      select: { amountCents: true, status: true, occurredAt: true },
      take: 2000,
    });
    const counted = moved.filter((t) => countsTowardBalance(t.status));
    const sum = (rows: typeof counted) => rows.reduce((n, t) => n + t.amountCents, 0);
    const thisWeek = counted.filter((t) => t.occurredAt >= from);
    const period = await db.budgetPeriod.findFirst({
      where: { organizationId, isActive: true },
      select: { id: true, label: true },
    });
    let periodFacts: NonNullable<RecapFacts["money"]>["period"] = null;
    if (period) {
      const allocated = await db.budgetCategory.aggregate({
        where: { organizationId, budgetPeriodId: period.id },
        _sum: { allocatedCents: true },
      });
      const spent = await db.transaction.aggregate({
        where: {
          organizationId,
          budgetPeriodId: period.id,
          direction: "OUT",
          voidedAt: null,
          status: { notIn: ["DRAFT", "REJECTED"] },
        },
        _sum: { amountCents: true },
      });
      periodFacts = {
        ...period,
        allocatedCents: allocated._sum.allocatedCents ?? 0,
        spentCents: spent._sum.amountCents ?? 0,
      };
    }
    money = {
      spentCents: sum(thisWeek),
      beforeCents: sum(counted.filter((t) => t.occurredAt < from)),
      period: periodFacts,
      transactions: await db.transaction.count({
        where: { organizationId, voidedAt: null, occurredAt: { gte: from, lt: to } },
      }),
    };

    const stuck = await db.transaction.findMany({
      where: {
        organizationId,
        voidedAt: null,
        kind: "EXPENSE",
        status: "SUBMITTED",
        createdAt: { lt: new Date(now.getTime() - STUCK_DAYS * DAY_MS) },
      },
      select: { taskId: true, submittedBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    if (stuck.length > 0) {
      const people: { id: string; name: string | null }[] = [];
      for (const s of stuck)
        if (!people.some((p) => p.id === s.submittedBy.id)) people.push(s.submittedBy);
      const taskIds = stuck.flatMap((s) => (s.taskId ? [s.taskId] : []));
      const blockedTask = taskIds.length
        ? await db.task.findFirst({
            where: {
              organizationId,
              deletedAt: null,
              ...taskSeen,
              id: { in: taskIds },
              status: "BLOCKED",
            },
            select: { id: true, title: true },
          })
        : null;
      waiting = { count: stuck.length, people, blockedTask };
    }
  }

  // Notes and comments.
  const written = await db.note.count({
    where: { organizationId, deletedAt: null, ...noteSeen, createdAt: { gte: from, lt: to } },
  });
  const writtenBefore = await db.note.count({
    where: {
      organizationId,
      deletedAt: null,
      ...noteSeen,
      createdAt: { gte: prevFrom, lt: from },
    },
  });
  const noteComments = await db.noteComment.groupBy({
    by: ["noteId"],
    where: {
      organizationId,
      createdAt: { gte: from, lt: to },
      ...(everyone ? { note: { visibility: "ORGANIZATION" as const, deletedAt: null } } : {}),
    },
    _count: { _all: true },
  });
  const taskComments = await db.taskComment.count({
    where: {
      organizationId,
      deletedAt: null,
      createdAt: { gte: from, lt: to },
      ...(everyone ? { task: { visibility: "ORG" as const } } : {}),
    },
  });
  const topNoteRow = [...noteComments].sort((a, b) => b._count._all - a._count._all)[0];
  const topNote = topNoteRow
    ? await db.note.findFirst({
        where: { organizationId, id: topNoteRow.noteId, deletedAt: null, ...noteSeen },
        select: { id: true, title: true },
      })
    : null;

  // Going well: the next sign-up page event against the last of its kind
  // at the same point (sign-up times are on registrations: admins only).
  let filling: RecapFacts["filling"] = null;
  if (isAdmin) {
    const next = await db.event.findFirst({
      where: {
        organizationId,
        deletedAt: null,
        mergedIntoId: null,
        rsvpEnabled: true,
        startsAt: { gt: now, lt: new Date(now.getTime() + 21 * DAY_MS) },
      },
      select: { id: true, title: true, kind: true, startsAt: true },
      orderBy: { startsAt: "asc" },
    });
    const prior = next
      ? await db.event.findFirst({
          where: {
            organizationId,
            deletedAt: null,
            mergedIntoId: null,
            rsvpEnabled: true,
            kind: next.kind,
            startsAt: { lt: now },
          },
          select: { id: true, title: true, startsAt: true },
          orderBy: { startsAt: "desc" },
        })
      : null;
    if (next && prior) {
      const lead = next.startsAt.getTime() - now.getTime();
      const cutoff = new Date(prior.startsAt.getTime() - lead);
      const rsvps = await db.eventRegistration.count({
        where: { organizationId, eventId: next.id, status: "GOING" },
      });
      // The same rule for the last one, as it stood at the cutoff: signed up
      // by then, not cancelled by then, and not waitlisted (it's GOING now,
      // or was until a cancellation after the cutoff).
      const atThisPoint = await db.eventRegistration.count({
        where: {
          organizationId,
          eventId: prior.id,
          createdAt: { lte: cutoff },
          status: { in: ["GOING", "CANCELLED"] },
          OR: [{ cancelledAt: null }, { cancelledAt: { gt: cutoff } }],
        },
      });
      const final = await db.eventRegistration.count({
        where: { organizationId, eventId: prior.id, status: "GOING" },
      });
      if (final > 0) {
        filling = {
          event: { id: next.id, title: next.title },
          rsvps,
          daysOut: Math.max(1, Math.round(lead / DAY_MS)),
          prior: { id: prior.id, title: prior.title, atThisPoint, final },
        };
      }
    }
  }

  // At risk: an event in the next 7 days with blocked tasks linked to it.
  const soon = await db.event.findMany({
    where: {
      organizationId,
      deletedAt: null,
      mergedIntoId: null,
      startsAt: { gt: now, lt: new Date(now.getTime() + 7 * DAY_MS) },
    },
    select: { id: true, title: true, startsAt: true },
    orderBy: { startsAt: "asc" },
    take: 20,
  });
  let atRisk: RecapFacts["atRisk"] = null;
  const links = await linkedTo(
    db,
    organizationId,
    "event",
    soon.map((e) => e.id),
    "task",
  );
  const linkedTaskIds = [...new Set([...links.values()].flat())];
  if (linkedTaskIds.length > 0) {
    const open = await db.task.findMany({
      where: {
        organizationId,
        deletedAt: null,
        ...taskSeen,
        id: { in: linkedTaskIds },
        status: { in: [...OPEN] },
      },
      select: { id: true, title: true, status: true },
    });
    for (const e of soon) {
      const mine = open.filter((t) => links.get(e.id)?.includes(t.id));
      const blocked = mine.filter((t) => t.status === "BLOCKED");
      if (blocked.length === 0) continue;
      if (!atRisk || blocked.length > atRisk.blocked.length) {
        atRisk = {
          event: {
            id: e.id,
            title: e.title,
            daysOut: Math.round((e.startsAt.getTime() - now.getTime()) / DAY_MS),
          },
          blocked: blocked.map(({ id, title }) => ({ id, title })),
          open: mine.length - blocked.length,
        };
      }
    }
  }

  // Stuck without money: the task blocked the longest.
  const longest = await db.task.findFirst({
    where: {
      organizationId,
      deletedAt: null,
      ...taskSeen,
      status: "BLOCKED",
      blockedAt: { lt: new Date(now.getTime() - LONG_BLOCKED_DAYS * DAY_MS) },
    },
    select: { id: true, title: true, blockedAt: true },
    orderBy: { blockedAt: "asc" },
  });

  return {
    base,
    from: dayOf(-7),
    to: dayOf(-1),
    tasks: {
      done: doneRows.length,
      before: weekly[1] ?? 0,
      topEpic,
      weekly,
      weekStarts,
    },
    members: {
      joined: joinedRows.length,
      before: joinedBefore,
      people: joinedRows.map((m) => m.user),
    },
    lastEvent,
    money,
    notes: {
      written,
      before: writtenBefore,
      comments: noteComments.reduce((n, c) => n + c._count._all, 0) + taskComments,
      busiest:
        topNote && topNoteRow
          ? { id: topNote.id, title: topNote.title || "Untitled", comments: topNoteRow._count._all }
          : null,
    },
    held: {
      meetings: held.filter(isMeeting).length,
      events: held.filter((e) => !isMeeting(e)).length,
    },
    filling,
    atRisk,
    waiting,
    longBlocked: longest?.blockedAt
      ? {
          id: longest.id,
          title: longest.title,
          days: Math.floor((now.getTime() - longest.blockedAt.getTime()) / DAY_MS),
        }
      : null,
  };
}
