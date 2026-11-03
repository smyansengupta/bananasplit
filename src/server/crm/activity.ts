import type { CrmActivityKind, CrmDirection, Prisma } from "@/generated/prisma/client";
import type { TxClient } from "@/server/db/context";

/**
 * The timeline (docs/features/crm.md, module 3). Every later phase writes
 * here: logActivity for anything that happened with people, companies or
 * pipeline items (an email, a call, a meeting, a stage move), timeline to
 * read it back. Rows mirrored from the workspace (events, RSVPs, check-ins,
 * form responses, tasks, payments) carry sourceKind/sourceId, unique per
 * organization, so logging the same thing twice updates it instead of
 * duplicating it, and a second mirror only adds targets.
 *
 * Outreach (email, call, text, meeting) moves each person's and company's
 * "last contacted" forward, so the follow-up queue and "going cold" stay
 * right without a job.
 */

export type ActivityTargetKind = "person" | "company" | "deal";

export interface ActivityTarget {
  kind: ActivityTargetKind;
  id: string;
}

export interface LogActivityInput {
  organizationId: string;
  kind: CrmActivityKind;
  targets: readonly ActivityTarget[];
  subject?: string | null;
  body?: string | null;
  occurredAt?: Date;
  direction?: CrmDirection | null;
  /** The member it was with or by (null for a job). */
  actorId?: string | null;
  /** Who logged it: must be the caller on the member path (RLS), null for a job. */
  createdById?: string | null;
  /** Mirrored rows: the workspace record it came from. */
  sourceKind?: string | null;
  sourceId?: string | null;
  meta?: Record<string, unknown>;
  privateToId?: string | null;
}

/** Kinds that count as being in touch. */
const OUTREACH: ReadonlySet<CrmActivityKind> = new Set(["EMAIL", "CALL", "TEXT", "MEETING"]);

function dedupeTargets(targets: readonly ActivityTarget[]): ActivityTarget[] {
  const seen = new Set<string>();
  return targets.filter((t) => {
    const k = `${t.kind}:${t.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Logs one activity (or updates the mirrored one); returns its id. */
export async function logActivity(db: TxClient, input: LogActivityInput): Promise<string> {
  const occurredAt = input.occurredAt ?? new Date();
  const targets = dedupeTargets(input.targets);
  const data = {
    kind: input.kind,
    direction: input.direction ?? null,
    subject: input.subject?.slice(0, 500) ?? null,
    body: input.body?.slice(0, 20_000) ?? null,
    occurredAt,
    actorId: input.actorId ?? null,
    meta: (input.meta ?? {}) as Prisma.InputJsonObject,
    privateToId: input.privateToId ?? null,
  };
  let id: string;
  if (input.sourceKind && input.sourceId) {
    const existing = await db.crmActivity.findFirst({
      where: {
        organizationId: input.organizationId,
        sourceKind: input.sourceKind,
        sourceId: input.sourceId,
      },
      select: { id: true },
    });
    if (existing) {
      id = existing.id;
      await db.crmActivity.update({ where: { id }, data: { ...data, deletedAt: null } });
    } else {
      id = (
        await db.crmActivity.create({
          data: {
            ...data,
            organizationId: input.organizationId,
            createdById: input.createdById ?? null,
            sourceKind: input.sourceKind,
            sourceId: input.sourceId,
          },
          select: { id: true },
        })
      ).id;
    }
  } else {
    id = (
      await db.crmActivity.create({
        data: {
          ...data,
          organizationId: input.organizationId,
          createdById: input.createdById ?? null,
        },
        select: { id: true },
      })
    ).id;
  }
  if (targets.length > 0) {
    await db.crmActivityTarget.createMany({
      data: targets.map((t) => ({
        organizationId: input.organizationId,
        activityId: id,
        targetKind: t.kind,
        targetId: t.id,
        occurredAt,
      })),
      skipDuplicates: true,
    });
    await db.crmActivityTarget.updateMany({
      where: { organizationId: input.organizationId, activityId: id },
      data: { occurredAt },
    });
  }
  if (OUTREACH.has(input.kind) && occurredAt.getTime() <= Date.now() + 60_000) {
    await touchContacted(db, input.organizationId, targets, occurredAt);
  }
  return id;
}

/** Moves "last contacted" forward (never back) on the people and companies named. */
export async function touchContacted(
  db: TxClient,
  organizationId: string,
  targets: readonly ActivityTarget[],
  at: Date,
): Promise<void> {
  const people = targets.filter((t) => t.kind === "person").map((t) => t.id);
  const companies = targets.filter((t) => t.kind === "company").map((t) => t.id);
  if (people.length > 0) {
    await db.crmPerson.updateMany({
      where: {
        organizationId,
        id: { in: people },
        OR: [{ lastContactedAt: null }, { lastContactedAt: { lt: at } }],
      },
      data: { lastContactedAt: at },
    });
    // A person's company was in touch too.
    const rows = await db.crmPerson.findMany({
      where: { organizationId, id: { in: people }, companyId: { not: null } },
      select: { companyId: true },
    });
    companies.push(...rows.map((r) => r.companyId!));
  }
  if (companies.length > 0) {
    await db.crmCompany.updateMany({
      where: {
        organizationId,
        id: { in: [...new Set(companies)] },
        OR: [{ lastContactedAt: null }, { lastContactedAt: { lt: at } }],
      },
      data: { lastContactedAt: at },
    });
  }
}

export interface TimelineEntry {
  id: string;
  kind: CrmActivityKind;
  direction: CrmDirection | null;
  subject: string | null;
  body: string | null;
  occurredAt: Date;
  actorId: string | null;
  createdById: string | null;
  sourceKind: string | null;
  sourceId: string | null;
  meta: Record<string, unknown>;
  /** Everything else it's about (another person at the same meeting, the item). */
  targets: ActivityTarget[];
}

export interface TimelineOptions {
  /** Older than this (the previous page's last occurredAt). */
  before?: Date;
  take?: number;
  kinds?: readonly CrmActivityKind[];
  /** A company's timeline includes its people's (default true). */
  includePeople?: boolean;
}

/**
 * One record's timeline, newest first, under the viewer's RLS (OWN access
 * hides others' activity; private rows show only to their member).
 */
export async function timeline(
  db: TxClient,
  organizationId: string,
  target: ActivityTarget,
  options: TimelineOptions = {},
): Promise<TimelineEntry[]> {
  const take = Math.min(options.take ?? 50, 200);
  let ids = [target.id];
  let kinds: string[] = [target.kind];
  if (target.kind === "company" && options.includePeople !== false) {
    const people = await db.crmPerson.findMany({
      where: { organizationId, companyId: target.id, deletedAt: null },
      select: { id: true },
      take: 500,
    });
    ids = [target.id, ...people.map((p) => p.id)];
    kinds = ["company", "person"];
  }
  const links = await db.crmActivityTarget.findMany({
    where: {
      organizationId,
      targetKind: { in: kinds },
      targetId: { in: ids },
      ...(options.before ? { occurredAt: { lt: options.before } } : {}),
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: take * 2,
    select: { activityId: true },
  });
  const activityIds = [...new Set(links.map((l) => l.activityId))];
  if (activityIds.length === 0) return [];
  const rows = await db.crmActivity.findMany({
    where: {
      organizationId,
      id: { in: activityIds },
      deletedAt: null,
      ...(options.kinds ? { kind: { in: [...options.kinds] } } : {}),
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take,
    select: {
      id: true,
      kind: true,
      direction: true,
      subject: true,
      body: true,
      occurredAt: true,
      actorId: true,
      createdById: true,
      sourceKind: true,
      sourceId: true,
      meta: true,
      targets: { select: { targetKind: true, targetId: true } },
    },
  });
  return rows.map((r) => ({
    ...r,
    meta: (r.meta && typeof r.meta === "object" ? r.meta : {}) as Record<string, unknown>,
    targets: r.targets
      .filter((t) => !(t.targetKind === target.kind && t.targetId === target.id))
      .map((t) => ({ kind: t.targetKind as ActivityTargetKind, id: t.targetId })),
  }));
}

/** Moves every activity of one record onto another (a merge), keeping each link once. */
export async function moveActivityTargets(
  db: TxClient,
  organizationId: string,
  kind: ActivityTargetKind,
  fromId: string,
  toId: string,
): Promise<number> {
  // Activities already on both: drop the duplicate link first.
  await db.$executeRaw`
    DELETE FROM "CrmActivityTarget" a
     WHERE a."organizationId" = ${organizationId} AND a."targetKind" = ${kind} AND a."targetId" = ${fromId}
       AND EXISTS (SELECT 1 FROM "CrmActivityTarget" b
                    WHERE b."organizationId" = a."organizationId" AND b."activityId" = a."activityId"
                      AND b."targetKind" = ${kind} AND b."targetId" = ${toId})`;
  const moved = await db.crmActivityTarget.updateMany({
    where: { organizationId, targetKind: kind, targetId: fromId },
    data: { targetId: toId },
  });
  return moved.count;
}
