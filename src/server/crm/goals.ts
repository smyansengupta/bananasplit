import { attainment, GOAL_LABELS, GOAL_METRICS, parsePeriodKey, type Attainment, type GoalMetric } from "@/lib/crm/forecast";
import { dayBounds } from "@/lib/tasks/dates";
import type { TxClient } from "@/server/db/context";

import { CrmError, requireCrm, requireManager, requireMember, type CrmActor } from "./access";
import { orgTimeZone } from "./forecast";

/**
 * Goals (docs/features/crm.md, module 8): a target per member, or for the
 * whole team, per quarter or year, on amount won, items won, people
 * reached, replies or meetings, optionally in one pipeline. Attainment is
 * read live from the CRM's own tables (Phase 2 fills the email ones),
 * over the period's days in the organization's timezone.
 */

export interface GoalView {
  id: string;
  name: string;
  metric: GoalMetric;
  metricLabel: string;
  pipelineId: string | null;
  ownerId: string | null;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  target: number;
  attainment: Attainment;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

function periodLabelOf(start: string, end: string): string {
  const year = parsePeriodKey(start.slice(0, 4));
  if (year && year.start === start && year.end === end) return year.label;
  const [y, m] = start.split("-").map(Number) as [number, number];
  const q = Math.floor((m - 1) / 3) + 1;
  return `Q${q} ${y}`;
}

/** What a goal's metric has reached so far in its period. */
export async function goalActual(
  db: TxClient,
  organizationId: string,
  goal: { metric: string; pipelineId: string | null; ownerId: string | null; periodStart: Date; periodEnd: Date },
): Promise<number> {
  // The period's days in the organization's timezone, start to end.
  const tz = await orgTimeZone(db, organizationId);
  const range = { gte: dayBounds(day(goal.periodStart), tz).start, lt: dayBounds(day(goal.periodEnd), tz).end };
  const owner = goal.ownerId;
  switch (goal.metric as GoalMetric) {
    case "amount_won":
    case "items_won": {
      const where = {
        organizationId,
        deletedAt: null,
        closedAt: range,
        stage: { kind: "WON" as const },
        ...(goal.pipelineId ? { pipelineId: goal.pipelineId } : {}),
        ...(owner ? { ownerId: owner } : {}),
      };
      if (goal.metric === "items_won") return db.crmDeal.count({ where });
      const agg = await db.crmDeal.aggregate({ where, _sum: { amountCents: true } });
      return agg._sum.amountCents ?? 0;
    }
    case "people_reached": {
      const rows = await db.crmActivityTarget.findMany({
        where: {
          organizationId,
          targetKind: "person",
          occurredAt: range,
          activity: {
            deletedAt: null,
            OR: [{ kind: { in: ["EMAIL", "CALL", "TEXT"] }, direction: "OUTBOUND" }, { kind: "MEETING" }],
            ...(owner ? { actorId: owner } : {}),
          },
        },
        distinct: ["targetId"],
        select: { targetId: true },
        take: 100_000,
      });
      return rows.length;
    }
    case "replies":
      return db.crmEmailMessage.count({
        where: {
          organizationId,
          direction: "INBOUND",
          createdAt: range,
          ...(owner ? { mailboxUserId: owner } : {}),
        },
      });
    case "meetings":
      return db.crmActivity.count({
        where: { organizationId, kind: "MEETING", deletedAt: null, occurredAt: range, ...(owner ? { actorId: owner } : {}) },
      });
    default:
      return 0;
  }
}

/** The goals whose period covers `today` (or every goal, newest first). */
export async function listGoals(
  db: TxClient,
  organizationId: string,
  today: string,
  options: { current?: boolean; take?: number } = {},
): Promise<GoalView[]> {
  const at = new Date(`${today}T00:00:00Z`);
  const rows = await db.crmGoal.findMany({
    where: { organizationId, ...(options.current ? { periodStart: { lte: at }, periodEnd: { gte: at } } : {}) },
    orderBy: [{ periodEnd: "desc" }, { createdAt: "asc" }],
    take: options.take ?? 50,
  });
  const out: GoalView[] = [];
  for (const g of rows) {
    const actual = await goalActual(db, organizationId, g);
    const start = day(g.periodStart);
    const end = day(g.periodEnd);
    const metric = (GOAL_METRICS as readonly string[]).includes(g.metric) ? (g.metric as GoalMetric) : "items_won";
    out.push({
      id: g.id,
      name: g.name,
      metric,
      metricLabel: GOAL_LABELS[metric],
      pipelineId: g.pipelineId,
      ownerId: g.ownerId,
      periodStart: start,
      periodEnd: end,
      periodLabel: periodLabelOf(start, end),
      target: g.target,
      attainment: attainment(actual, g.target, { start, end }, today),
    });
  }
  return out;
}

export async function saveGoal(
  actor: CrmActor,
  input: { id?: string | null; metric: string; periodKey: string; target: number; ownerId?: string | null; pipelineId?: string | null; name?: string | null },
): Promise<{ id: string }> {
  requireManager(await requireCrm(actor));
  const { db, organizationId, userId } = actor;
  if (!(GOAL_METRICS as readonly string[]).includes(input.metric)) throw new CrmError("Pick what the goal counts.");
  const metric = input.metric as GoalMetric;
  const period = parsePeriodKey(input.periodKey);
  if (!period) throw new CrmError("Pick a quarter or a year.");
  const target = metric === "amount_won" ? Math.round(Number(input.target) * 100) : Math.round(Number(input.target));
  if (!Number.isFinite(target) || target <= 0 || target > 1e12) throw new CrmError("Give a target above zero.");
  if (input.ownerId) await requireMember(db, organizationId, input.ownerId);
  if (input.pipelineId) {
    const p = await db.crmPipeline.count({ where: { id: input.pipelineId, organizationId } });
    if (!p) throw new CrmError("That pipeline isn't there any more.");
  }
  const owner = input.ownerId
    ? await db.user.findUnique({ where: { id: input.ownerId }, select: { name: true } })
    : null;
  const name =
    input.name?.trim().slice(0, 120) ||
    `${GOAL_LABELS[metric]}, ${owner ? (owner.name ?? "a member") : "the team"}, ${period.label}`;
  const data = {
    name,
    metric,
    pipelineId: input.pipelineId ?? null,
    ownerId: input.ownerId ?? null,
    periodStart: new Date(`${period.start}T00:00:00Z`),
    periodEnd: new Date(`${period.end}T00:00:00Z`),
    target,
  };
  if (input.id) {
    const found = await db.crmGoal.findFirst({ where: { id: input.id, organizationId }, select: { id: true } });
    if (!found) throw new CrmError("That goal isn't there any more.");
    await db.crmGoal.update({ where: { id: found.id }, data });
    return found;
  }
  return db.crmGoal.create({ data: { organizationId, ...data, createdById: userId }, select: { id: true } });
}

export async function deleteGoal(actor: CrmActor, id: string): Promise<void> {
  requireManager(await requireCrm(actor));
  await actor.db.crmGoal.deleteMany({ where: { id, organizationId: actor.organizationId } });
}
