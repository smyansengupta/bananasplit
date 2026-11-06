import type { Prisma } from "@/generated/prisma/client";
import {
  computeForecast,
  computeTrend,
  periodOf,
  readSnapshot,
  type Forecast,
  type ForecastItem,
  type Period,
  type SnapshotData,
  type Trend,
} from "@/lib/crm/forecast";
import { safeTimeZone } from "@/lib/calendar/dates";
import { localDateKey } from "@/lib/tasks/dates";
import type { TxClient } from "@/server/db/context";

/**
 * Forecasts per pipeline (docs/features/crm.md, module 8), the server half:
 * the items as the forecast reads them and the weekly snapshot (crm-daily),
 * kept as CrmForecastSnapshot rows.
 * Quarters and years are the organization's: a close is counted on its day
 * in the organization's timezone.
 */

/** A moment's day in the organization's timezone (an item closed late on March 31 in New York is Q1's). */
const dayIn = (d: Date | null | undefined, tz: string) => (d ? localDateKey(d, tz) : null);
/** An expected date is a calendar date already (stored at noon UTC). */
const dateOnly = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export async function orgTimeZone(db: TxClient, organizationId: string): Promise<string> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  return safeTimeZone(org?.timezone ?? "UTC");
}

export async function forecastItems(
  db: TxClient,
  organizationId: string,
  pipelineId: string,
  options: { ownerId?: string | null; since?: Date } = {},
): Promise<ForecastItem[]> {
  const since = options.since ?? new Date(Date.now() - 2 * 365 * 86_400_000);
  const tz = await orgTimeZone(db, organizationId);
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
    expectedOn: dateOnly(r.expectedOn),
    closedOn: dayIn(r.closedAt, tz),
    stageKind: r.stage.kind,
    probability: r.stage.kind === "OPEN" ? r.stage.probability : r.stage.kind === "WON" ? 100 : 0,
    category: r.forecastCategory,
    ownerId: r.ownerId,
  }));
}

async function closedHistory(db: TxClient, organizationId: string, pipelineId: string, ownerId?: string | null) {
  const tz = await orgTimeZone(db, organizationId);
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
    createdOn: dayIn(r.createdAt, tz)!,
    closedOn: dayIn(r.closedAt, tz)!,
    won: r.stage.kind === "WON",
    amountCents: r.amountCents,
  }));
}

export interface PipelineForecast {
  forecast: Forecast;
  trend: Trend;
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
  const open = items.filter(
    (i) => i.stageKind === "OPEN" && (i.expectedOn ? i.expectedOn >= period.start && i.expectedOn <= period.end : current),
  );
  return {
    forecast,
    trend,
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
