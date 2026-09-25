import type { Prisma } from "@/generated/prisma/client";
import type { TxClient } from "@/server/db/context";

/**
 * DataSourceSyncState: one row per (integration, stream), written only on
 * the service path. `watermark` is the stream's resume point and the value
 * the compare-and-set checks, so a batch from a stale run can never move it
 * backwards or skip rows another run already took.
 */

export const STREAMS = [
  "sessions",
  "signups",
  "checkins",
  "ballots",
  "unsubscribes",
  "reconcile",
] as const;
export type Stream = (typeof STREAMS)[number];

export const STREAM_LABELS: Record<Stream, string> = {
  sessions: "Sessions",
  signups: "Signups",
  checkins: "Check-ins",
  ballots: "Ballots",
  unsubscribes: "Unsubscribes",
  reconcile: "Weekly reconcile",
};

export interface StateRow {
  id: string;
  stream: string;
  watermark: Prisma.JsonValue;
}

export class StaleWatermarkError extends Error {
  constructor(stream: string) {
    super(`${stream}: another sync run moved the watermark first`);
    this.name = "StaleWatermarkError";
  }
}

/** Creates the state rows that are missing and returns all of them by stream. */
export async function ensureStates(
  db: TxClient,
  organizationId: string,
  integrationId: string,
): Promise<Map<string, StateRow>> {
  await db.dataSourceSyncState.createMany({
    data: STREAMS.map((stream) => ({
      id: `dss_${integrationId}_${stream}`.slice(0, 100),
      organizationId,
      integrationId,
      stream,
      watermark: {},
    })),
    skipDuplicates: true,
  });
  const rows = await db.dataSourceSyncState.findMany({
    where: { organizationId, integrationId },
    select: { id: true, stream: true, watermark: true },
  });
  return new Map(rows.map((r) => [r.stream, r]));
}

/**
 * Compare-and-set: moves the watermark from `expected` to `next` only if no
 * other run changed it in between; throws StaleWatermarkError otherwise (the
 * caller's transaction then rolls back the batch it just wrote).
 */
export async function advanceWatermark(
  db: TxClient,
  state: StateRow,
  expected: Prisma.JsonValue,
  next: Prisma.InputJsonValue,
  rows: number,
): Promise<void> {
  const updated = await db.dataSourceSyncState.updateMany({
    where: { id: state.id, watermark: { equals: (expected ?? {}) as Prisma.InputJsonValue } },
    data: {
      watermark: next,
      lastSyncedAt: new Date(),
      lastError: null,
      rowsUpserted: { increment: rows },
    },
  });
  if (updated.count === 0) throw new StaleWatermarkError(state.stream);
}

/** Records a finished pass of a full-refresh stream (no keyset to protect). */
export async function markStream(
  db: TxClient,
  state: StateRow,
  watermark: Prisma.InputJsonValue,
  rows: number,
): Promise<void> {
  await db.dataSourceSyncState.update({
    where: { id: state.id },
    data: {
      watermark,
      lastSyncedAt: new Date(),
      lastError: null,
      rowsUpserted: { increment: rows },
    },
  });
}

export async function recordStreamError(
  db: TxClient,
  state: StateRow,
  error: string,
): Promise<void> {
  await db.dataSourceSyncState.update({
    where: { id: state.id },
    data: { lastError: error.slice(0, 500) },
  });
}
