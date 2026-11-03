import type { Prisma } from "@/generated/prisma/client";
import {
  computeForecast,
  computeTrend,
  periodOf,
  readSnapshot,
  shiftPeriod,
  type CallData,
  type Forecast,
  type ForecastItem,
  type Period,
  type SnapshotData,
  type Trend,
} from "@/lib/crm/forecast";
import type { TxClient } from "@/server/db/context";

import { CrmError, requireCrm, requireManager, type CrmActor } from "./access";

/**
 * Forecasts per pipeline (docs/features/crm.md, module 8), the server half:
 * the items as the forecast reads them, the weekly snapshot (crm-daily)
 * and a manager's own call. Snapshots are CrmForecastSnapshot rows; a
 * manager's call is one too (data.kind "call"), the newest one standing.
 */

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export async function forecastItems(
  db: TxClient,
  organizationId: string,
  pipelineId: string,
  options: { ownerId?: string | null; since?: Date } = {},
): Promise<ForecastItem[]> {
  const since = options.since ?? new Date(Date.now() - 2 * 365 * 86_400_000);
  const rows = await db.crmDeal.findMany({
    where: {
      organizationId,
      pipelineId,
      deletedAt: null,
      ...(options.ownerId ? { ownerId: options.ownerId } : {}),
      OR: [{ closedAt: null }, { closedAt: { gte: since } }],
    },
    select: {
      id: true,
      amountCents: true,
      expectedOn: true,
      closedAt: true,
      forecastCategory: true,
      ownerId: true,
      stage: { select: { kind: true, probability: true } },
    },
    take: 20_000,
  });
  return rows.map((r) => ({
    id: r.id,
    amountCents: r.amountCents,
    expectedOn: day(r.expectedOn),
    closedOn: day(r.closedAt),
    stageKind: r.stage.kind,
    probability: r.stage.kind === "OPEN" ? r.stage.probability : r.stage.kind === "WON" ? 100 : 0,
    category: r.forecastCategory,
    ownerId: r.ownerId,
  }));
}

async function closedHistory(db: TxClient, organizationId: string, pipelineId: string, ownerId?: string | null) {
  const rows = await db.crmDeal.findMany({
    where: {
      organizationId,
      pipelineId,
      deletedAt: null,
      closedAt: { gte: new Date(Date.now() - 3 * 365 * 86_400_000) },
      stage: { kind: { in: ["WON", "LOST"] } },
      ...(ownerId ? { ownerId } : {}),
    },
    select: { createdAt: true, closedAt: true, amountCents: true, stage: { select: { kind: true } } },
    take: 20_000,
  });
  return rows.map((r) => ({
    createdOn: day(r.createdAt)!,
    closedOn: day(r.closedAt)!,
    won: r.stage.kind === "WON",
    amountCents: r.amountCents,
  }));
}

export interface OwnerRow {
  ownerId: string | null;
  commit: number;
  bestCase: number;
  pipeline: number;
  won: number;
  commitCount: number;
  bestCaseCount: number;
  pipelineCount: number;
  wonCount: number;
}

export interface PipelineForecast {
  forecast: Forecast;
  trend: Trend;
  call: (CallData & { at: Date }) | null;
  byOwner: OwnerRow[];
  /** Open items in the period, for the list under the numbers. */
  items: ForecastItem[];
}

export async function pipelineForecast(
  db: TxClient,
  organizationId: string,
  pipelineId: string,
  period: Period,
  today: string,
  ownerId?: string | null,
): Promise<PipelineForecast> {
  const items = await forecastItems(db, organizationId, pipelineId, { ownerId });
  const current = today >= period.start && today <= period.end;
  const forecast = computeForecast(items, period, current);
  const trend = computeTrend(items, period, current, await closedHistory(db, organizationId, pipelineId, ownerId));
  const owners = new Map<string | null, ForecastItem[]>();
  for (const i of items) owners.set(i.ownerId, [...(owners.get(i.ownerId) ?? []), i]);
  const byOwner: OwnerRow[] = [...owners.entries()]
    .map(([o, list]) => {
      const f = computeForecast(list, period, current);
      return {
        ownerId: o,
        commit: f.commit.amount,
        bestCase: f.bestCase.amount,
        pipeline: f.pipeline.amount,
        won: f.won.amount,
        commitCount: f.commit.count,
        bestCaseCount: f.bestCase.count,
        pipelineCount: f.pipeline.count,
        wonCount: f.won.count,
      };
    })
    .filter((r) => r.pipelineCount > 0)
    .sort((a, b) => b.pipeline - a.pipeline || b.pipelineCount - a.pipelineCount);
  const callRow = ownerId
    ? null
    : await db.crmForecastSnapshot.findFirst({
        where: { organizationId, pipelineId, periodLabel: `call:${period.key}` },
        orderBy: { takenAt: "desc" },
      });
  const call = callRow ? readSnapshot(callRow.data) : null;
  const open = items.filter(
    (i) => i.stageKind === "OPEN" && (i.expectedOn ? i.expectedOn >= period.start && i.expectedOn <= period.end : current),
  );
  return {
    forecast,
    trend,
    call: call && call.kind === "call" ? { ...call, at: callRow!.takenAt } : null,
    byOwner,
    items: open,
  };
}

/** Takes this week's snapshot of a pipeline's period (once a week). */
export async function takeSnapshot(
  db: TxClient,
  organizationId: string,
  pipelineId: string,
  period: Period,
  today: string,
  now: Date = new Date(),
  force = false,
): Promise<boolean> {
  if (!force) {
    const last = await db.crmForecastSnapshot.findFirst({
      where: { organizationId, pipelineId, periodLabel: period.key },
      orderBy: { takenAt: "desc" },
      select: { takenAt: true },
    });
    if (last && now.getTime() - last.takenAt.getTime() < 6 * 86_400_000) return false;
  }
  const f = await pipelineForecast(db, organizationId, pipelineId, period, today);
  const data: SnapshotData = {
    kind: "snapshot",
    period: period.key,
    won: f.forecast.won,
    weighted: f.forecast.weighted,
    commit: f.forecast.commit,
    bestCase: f.forecast.bestCase,
    pipeline: f.forecast.pipeline,
    trend: f.trend.enough ? f.trend.expected : null,
    call: f.call ? { amount: f.call.amount, count: f.call.count } : null,
    items: f.items.slice(0, 2000).map((i) => ({ id: i.id, c: i.category, a: i.amountCents, s: i.expectedOn ?? "" })),
  };
  await db.crmForecastSnapshot.create({
    data: { organizationId, pipelineId, periodLabel: period.key, data: data as unknown as Prisma.InputJsonObject, takenAt: now },
  });
  return true;
}

/** The weekly snapshots of every pipeline's current quarter and year (crm-daily). */
export async function weeklySnapshots(db: TxClient, organizationId: string, today: string, now: Date = new Date()): Promise<number> {
  const pipelines = await db.crmPipeline.findMany({ where: { organizationId, archivedAt: null }, select: { id: true } });
  let n = 0;
  for (const p of pipelines) {
    for (const period of [periodOf("quarter", today), periodOf("year", today)]) {
      if (await takeSnapshot(db, organizationId, p.id, period, today, now)) n++;
    }
  }
  return n;
}

export async function snapshotsFor(db: TxClient, organizationId: string, pipelineId: string, period: Period) {
  const rows = await db.crmForecastSnapshot.findMany({
    where: { organizationId, pipelineId, periodLabel: period.key },
    orderBy: { takenAt: "asc" },
    take: 60,
  });
  return rows.flatMap((r) => {
    const d = readSnapshot(r.data);
    return d && d.kind === "snapshot" ? [{ id: r.id, at: r.takenAt, data: d }] : [];
  });
}

/** A manager's own call over the roll-up. */
export async function saveForecastCall(
  actor: CrmActor,
  input: { pipelineId: string; periodKey: string; amount: number; count: number; note?: string | null },
  period: Period,
): Promise<void> {
  requireManager(await requireCrm(actor));
  const { db, organizationId, userId } = actor;
  const p = await db.crmPipeline.findFirst({ where: { id: input.pipelineId, organizationId }, select: { id: true } });
  if (!p) throw new CrmError("That pipeline isn't there any more.");
  if (!Number.isFinite(input.amount) || input.amount < 0 || input.amount > 1e12) throw new CrmError("Give an amount of zero or more.");
  if (!Number.isFinite(input.count) || input.count < 0 || input.count > 1e6) throw new CrmError("Give a number of zero or more.");
  const data: CallData = {
    kind: "call",
    period: period.key,
    amount: Math.round(input.amount * 100),
    count: Math.round(input.count),
    note: input.note?.trim().slice(0, 300) || null,
    by: userId,
  };
  await db.crmForecastSnapshot.create({
    data: { organizationId, pipelineId: p.id, periodLabel: `call:${period.key}`, data: data as unknown as Prisma.InputJsonObject },
  });
}

export { shiftPeriod };
