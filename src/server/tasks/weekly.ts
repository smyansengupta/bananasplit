import { z } from "zod";

import { Prisma, Role, TaskStatus } from "@/generated/prisma/client";
import {
  addDaysToKey,
  dueDateKey,
  fromDateKey,
  isDateKey,
  localDateKey,
  weekBounds,
  weekdayOfKey,
} from "@/lib/tasks/dates";
import { summaryLines, type WeeklyItem, type WeeklySummary } from "@/lib/tasks/weekly-text";
import type { TxClient } from "@/server/db/context";
import { userPublicSelect } from "@/server/members";

import type { TaskEnv } from "./service";
import { TaskError } from "./service";

export type { WeeklyItem, WeeklySummary };

/**
 * The Sunday update helper (view=updates). Weeks run Monday 00:00 to Sunday
 * 23:59 in the org's timezone ('How we work': every lead posts done / next /
 * blocked by Sunday night).
 *
 * - Done: completed during the week (owned or involved).
 * - Next: open tasks due within 7 days of the week's reference day (today
 *   for the current week, else its Sunday), overdue ones included, or in
 *   progress.
 * - Blocked: BLOCKED, with the reason.
 *
 * 'Post update' snapshots the three lists (as lines of text) into a
 * WeeklyUpdate with an optional note. OWNER/ADMIN, and whoever holds the top
 * of the chart, see who hasn't posted yet.
 */

const weeklyItemSelect = {
  id: true,
  title: true,
  status: true,
  dueDate: true,
  completedAt: true,
  blockedReason: true,
  ownerId: true,
  parentTask: { select: { title: true } },
} satisfies Prisma.TaskSelect;

function toItem(
  t: Prisma.TaskGetPayload<{ select: typeof weeklyItemSelect }>,
  userId: string,
): WeeklyItem {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    dueKey: t.dueDate ? dueDateKey(t.dueDate) : null,
    blockedReason: t.blockedReason,
    role: t.ownerId === userId ? "owner" : "collaborator",
    parentTitle: t.parentTask?.title ?? null,
  };
}

export async function getWeeklySummary(
  db: TxClient,
  organizationId: string,
  userId: string,
  weekStart: string,
  tz: string,
  now: Date = new Date(),
): Promise<WeeklySummary> {
  const { start, end } = weekBounds(weekStart, tz);
  const mine: Prisma.TaskWhereInput = {
    organizationId,
    deletedAt: null,
    OR: [{ ownerId: userId }, { assignees: { some: { userId } } }],
  };
  const sunday = addDaysToKey(weekStart, 6);
  const today = localDateKey(now, tz);
  const reference = today < sunday ? today : sunday;
  const horizon = fromDateKey(addDaysToKey(reference, 7));

  const done = await db.task.findMany({
    where: { AND: [mine, { status: TaskStatus.COMPLETED, completedAt: { gte: start, lt: end } }] },
    select: weeklyItemSelect,
    orderBy: { completedAt: "asc" },
    take: 100,
  });
  const next = await db.task.findMany({
    where: {
      AND: [
        mine,
        {
          OR: [
            { status: TaskStatus.IN_PROGRESS },
            { status: TaskStatus.NOT_STARTED, dueDate: { lte: horizon } },
          ],
        },
      ],
    },
    select: weeklyItemSelect,
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { priority: "desc" }],
    take: 100,
  });
  const blocked = await db.task.findMany({
    where: { AND: [mine, { status: TaskStatus.BLOCKED }] },
    select: weeklyItemSelect,
    orderBy: { blockedAt: "asc" },
    take: 100,
  });
  return {
    weekStart,
    done: done.map((t) => toItem(t, userId)),
    next: next.map((t) => toItem(t, userId)),
    blocked: blocked.map((t) => toItem(t, userId)),
  };
}

/**
 * Who is expected to post: the leads, meaning everyone holding a filled,
 * non-advisor position in the published chart below its top (the top reads
 * the updates). Without a chart: members with a title. Sorted by name.
 */
export async function expectedPosters(
  db: TxClient,
  organizationId: string,
): Promise<{ userId: string; name: string | null; title: string | null }[]> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { activeOrgChartVersionId: true },
  });
  let ids: string[] = [];
  if (org?.activeOrgChartVersionId) {
    const positions = await db.orgChartPosition.findMany({
      where: {
        organizationId,
        versionId: org.activeOrgChartVersionId,
        isAdvisor: false,
        isOpen: false,
        userId: { not: null },
        reportsToId: { not: null },
      },
      select: { userId: true },
    });
    ids = [...new Set(positions.map((p) => p.userId as string))];
  }
  const members = await db.membership.findMany({
    where: ids.length > 0 ? { organizationId, userId: { in: ids } } : { organizationId, title: { not: null } },
    select: { userId: true, title: true, user: { select: { name: true } } },
  });
  return members
    .map((m) => ({ userId: m.userId, name: m.user.name, title: m.title }))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}

/** Who sees 'who hasn't posted': OWNER/ADMIN, and the holder(s) of the chart's top position. */
export async function canSeeWhoPosted(
  db: TxClient,
  organizationId: string,
  userId: string,
  role: Role,
): Promise<boolean> {
  if (role === Role.OWNER || role === Role.ADMIN) return true;
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { activeOrgChartVersionId: true },
  });
  if (!org?.activeOrgChartVersionId) return false;
  const top = await db.orgChartPosition.count({
    where: {
      organizationId,
      versionId: org.activeOrgChartVersionId,
      reportsToId: null,
      isAdvisor: false,
      userId,
    },
  });
  return top > 0;
}

export function getWeekUpdates(db: TxClient, organizationId: string, weekStart: string) {
  return db.weeklyUpdate.findMany({
    where: { organizationId, weekStart: fromDateKey(weekStart) },
    select: {
      id: true,
      userId: true,
      done: true,
      next: true,
      blocked: true,
      note: true,
      postedAt: true,
      user: { select: userPublicSelect },
    },
  });
}

export type WeekUpdateRow = Awaited<ReturnType<typeof getWeekUpdates>>[number];

export const postWeeklyUpdateSchema = z.object({
  weekStart: z.string().refine((v) => isDateKey(v) && weekdayOfKey(v) === 1, "Pick a week."),
  note: z.string().trim().max(2000).nullable().optional(),
});

/** Posts (or re-posts) the actor's own update for a week, snapshotting the helper's lists. */
export async function postWeeklyUpdate(env: TaskEnv, input: unknown): Promise<{ error?: string }> {
  const parsed = postWeeklyUpdateSchema.safeParse(input);
  if (!parsed.success) throw new TaskError(parsed.error.issues[0]?.message ?? "Invalid input");
  const { weekStart, note } = parsed.data;
  const { db, organizationId } = env.ctx;
  const tz = env.org.timezone;
  const today = localDateKey(env.now, tz);
  if (weekStart > today) throw new TaskError("You can't post an update for a future week.");
  const summary = await getWeeklySummary(db, organizationId, env.actor.userId, weekStart, tz, env.now);
  const lines = summaryLines(summary, today);
  const data = {
    done: lines.done,
    next: lines.next,
    blocked: lines.blocked,
    note: note || null,
    postedAt: env.now,
  };
  await db.weeklyUpdate.upsert({
    where: {
      organizationId_userId_weekStart: {
        organizationId,
        userId: env.actor.userId,
        weekStart: fromDateKey(weekStart),
      },
    },
    create: { organizationId, userId: env.actor.userId, weekStart: fromDateKey(weekStart), ...data },
    update: data,
  });
  return {};
}

/** A stored WeeklyUpdate list (JSON) as lines of text. */
export function storedLines(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v : v && typeof v === "object" && "title" in v ? String(v.title) : null))
    .filter((v): v is string => Boolean(v));
}
