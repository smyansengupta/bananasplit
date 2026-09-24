import type pg from "pg";

import { IntegrationProvider, IntegrationStatus, type Prisma } from "@/generated/prisma/client";
import { markDataChanged, refreshRollups } from "@/server/databases/rollups";
import { withSystemOrgTx } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";
import { sanitize } from "@/server/jobs/sanitize";
import { PermanentJobError, type JobHandler, type JobOutcome } from "@/server/jobs/types";
import { getSecret } from "@/server/secrets";

import {
  applyBallots,
  applyCheckins,
  applySessions,
  applySignups,
  applyUnsubscribes,
  removeMissing,
  type ApplyStats,
  type SyncScope,
} from "./apply";
import {
  describeConnectionError,
  openSourceClient,
  parseSourceConfig,
  SourceConfigError,
  SUPPORTED_CONTRACT_VERSIONS,
} from "./connection";
import { backstop, RECONCILE_EVERY_MS, requestSync } from "./enqueue";
import { mapCheckinSource } from "./supabase-map";
import { BATCH_SIZE, sourceReader, type Keyset, type SourceReader } from "./remote";
import {
  advanceWatermark,
  ensureStates,
  markStream,
  recordStreamError,
  StaleWatermarkError,
  type StateRow,
  type Stream,
} from "./state";

/**
 * The source-sync job handler (Phase 4b; registry kind "source-sync",
 * heavy, run only from /api/cron/jobs or `pnpm jobs:drain`).
 *
 *   1. A short service transaction loads the integration, the org timezone,
 *      the members' verified emails and the stream states, and schedules the
 *      next hourly backstop run.
 *   2. Outside any transaction: the DB_PASSWORD secret is decrypted through
 *      the accessor and ONE read-only connection is opened to the website's
 *      suite_export contract (verify-full TLS, 10s statement timeout).
 *   3. Streams, in dependency order: sessions (full refresh), signups and
 *      check-ins (keyset on (updated_at|created_at, id), <= 1000 rows per
 *      fetch), ballots (paged by id; only unseen ones are written),
 *      unsubscribes (full). Each fetched batch is written in its own short
 *      withSystemOrgTx: idempotent upserts, the rollup refresh for the
 *      touched contacts, the reports data-version bump, and a
 *      compare-and-set of the stream's watermark.
 *   4. Weekly (or when forced) a full reconcile re-reads every check-in and
 *      signup from the start, re-attributes rows after contact splits,
 *      removes synced rows deleted at the source and recomputes every
 *      rollup of the org.
 *   5. When the run's budget (maxRuntime less a margin) is spent, the job
 *      re-enqueues itself under its coalesced key and continues next time.
 *
 * Keyset tail: rows newer than TAIL_LAG are written but the watermark stops
 * short of them, so a check-in whose transaction committed late (with an
 * earlier created_at) is still read on the next run. Re-reads are harmless.
 */

export interface SourceSyncPayload {
  integrationId: string;
  stream: string;
}

export const TAIL_LAG_MS = 2 * 60 * 1000;
/** Stop starting new batches this long before the job's deadline. */
export const SAFETY_MS = 25_000;
export const BALLOT_BATCH = 500;

type Totals = Record<string, number>;

export interface Loaded {
  scope: SyncScope;
  config: unknown;
  states: Map<string, StateRow>;
  lastReconcileAt: Date | null;
}

/** Step 1 of a run (exported for the database tests). */
export async function loadSyncContext(orgId: string, integrationId: string): Promise<Loaded | null> {
  return withSystemOrgTx(orgId, async ({ db }) => {
    const integration = await db.orgIntegration.findFirst({
      where: { id: integrationId, organizationId: orgId, provider: IntegrationProvider.SUPABASE_SOURCE },
      select: { id: true, config: true, connectedById: true, secretFingerprint: true },
    });
    const org = await db.organization.findUnique({ where: { id: orgId }, select: { timezone: true, deletedAt: true } });
    if (!integration || !integration.secretFingerprint || !org || org.deletedAt) return null;

    const members = await db.membership.findMany({
      where: { organizationId: orgId },
      select: { role: true, userId: true, user: { select: { email: true, emailVerified: true } } },
    });
    const memberEmails = new Map<string, string>();
    for (const m of members) {
      if (m.user.emailVerified && m.user.email) memberEmails.set(m.user.email.trim().toLowerCase(), m.userId);
    }
    const connected = members.find((m) => m.userId === integration.connectedById);
    const owner = members.find((m) => m.role === "OWNER");
    const creatorId = connected?.userId ?? owner?.userId ?? members[0]?.userId;
    if (!creatorId) return null;

    const states = await ensureStates(db, orgId, integrationId);
    const next = backstop(integrationId);
    await enqueueJob(db, {
      orgId,
      kind: "source-sync",
      key: next.key,
      payload: { integrationId, stream: "all" },
      runAt: next.runAt,
      noKick: true,
    });
    const reconcile = states.get("reconcile")?.watermark as { lastAt?: string } | null;
    return {
      scope: { organizationId: orgId, timezone: org.timezone || "UTC", creatorId, memberEmails },
      config: integration.config,
      states,
      lastReconcileAt: reconcile?.lastAt ? new Date(reconcile.lastAt) : null,
    };
  });
}

async function recordIntegration(orgId: string, integrationId: string, error: string | null): Promise<void> {
  await withSystemOrgTx(orgId, async ({ db }) => {
    await db.orgIntegration.updateMany({
      where: { id: integrationId, organizationId: orgId },
      data: error
        ? { status: IntegrationStatus.ERROR, lastError: error }
        : { status: IntegrationStatus.CONNECTED, lastError: null },
    });
  });
}

/** Writes one batch in its own service transaction: apply, rollups, data version, watermark. */
async function writeBatch(
  scope: SyncScope,
  state: StateRow,
  apply: (db: Prisma.TransactionClient) => Promise<ApplyStats>,
  watermark: { expected: Prisma.JsonValue; next: Prisma.InputJsonValue } | { full: Prisma.InputJsonValue } | null,
): Promise<ApplyStats> {
  return withSystemOrgTx(scope.organizationId, async ({ db }) => {
    const stats = await apply(db);
    if (stats.contacts.length) await refreshRollups(db, scope.organizationId, stats.contacts);
    if (stats.upserted > 0) await markDataChanged(db, scope.organizationId);
    if (watermark && "full" in watermark) await markStream(db, state, watermark.full, stats.upserted);
    else if (watermark) await advanceWatermark(db, state, watermark.expected, watermark.next, stats.upserted);
    return stats;
  });
}

function wmOf(state: StateRow): { ts: string | null; id: string | null; unmapped: number } {
  const w = (state.watermark ?? {}) as { ts?: string; id?: string; unmapped?: number };
  return { ts: w.ts ?? null, id: w.id ?? null, unmapped: Number(w.unmapped ?? 0) };
}

interface StreamRun {
  done: boolean;
  totals: Totals;
  seen?: Set<string>;
}

/**
 * A keyset stream (checkins, signups). With `reconcile`, reads from the
 * start without touching the stream's watermark and collects every id.
 */
async function keysetStream<Row extends { id: string }>(opts: {
  stream: "checkins" | "signups";
  scope: SyncScope;
  state: StateRow;
  fetch: (after: Keyset) => Promise<Row[]>;
  apply: (db: Prisma.TransactionClient, rows: Row[]) => Promise<ApplyStats>;
  tsOf: (row: Row) => Date;
  timeLeft: () => boolean;
  reconcile?: boolean;
  /** Check-ins: whether a row's source is outside the known mapping (counted in the watermark). */
  isUnmapped?: (row: Row) => boolean;
}): Promise<StreamRun> {
  const totals: Totals = { upserted: 0, skipped: 0, unmapped: 0, batches: 0 };
  const seen = opts.reconcile ? new Set<string>() : undefined;
  let wm = opts.reconcile ? { ts: null, id: null, unmapped: 0 } : wmOf(opts.state);
  let expected = opts.state.watermark;
  for (;;) {
    if (!opts.timeLeft()) return { done: false, totals, seen };
    const rows = await opts.fetch({ ts: wm.ts, id: wm.id });
    if (rows.length === 0) {
      if (!opts.reconcile) {
        await withSystemOrgTx(opts.scope.organizationId, ({ db }) =>
          markStream(db, opts.state, (expected ?? {}) as Prisma.InputJsonValue, 0),
        );
      }
      return { done: true, totals, seen };
    }
    rows.forEach((r) => seen?.add(r.id));
    const cutoff = Date.now() - TAIL_LAG_MS;
    let next = { ts: wm.ts, id: wm.id };
    let unmapped = wm.unmapped;
    for (const r of rows) {
      const t = opts.tsOf(r);
      if (opts.reconcile || t.getTime() <= cutoff) {
        next = { ts: t.toISOString(), id: r.id };
        if (opts.isUnmapped?.(r)) unmapped += 1;
      }
    }
    const stats = await writeBatch(
      opts.scope,
      opts.state,
      (db) => opts.apply(db, rows),
      opts.reconcile
        ? null
        : {
            expected,
            next: { ts: next.ts, id: next.id, unmapped } as Prisma.InputJsonValue,
          },
    );
    totals.upserted += stats.upserted;
    totals.skipped += stats.skipped;
    totals.unmapped += stats.unmapped ?? 0;
    totals.batches += 1;
    const advanced = next.ts !== wm.ts || next.id !== wm.id;
    wm = { ts: next.ts, id: next.id, unmapped };
    expected = { ts: next.ts, id: next.id, unmapped } as Prisma.JsonValue;
    if (opts.reconcile && rows.length === BATCH_SIZE) {
      const last = rows[rows.length - 1];
      wm = { ts: opts.tsOf(last).toISOString(), id: last.id, unmapped };
      continue;
    }
    if (rows.length < BATCH_SIZE || !advanced) return { done: true, totals, seen };
  }
}

/** Every ballot, paged by id; only unseen ones are written. */
async function ballotsStream(
  scope: SyncScope,
  state: StateRow,
  reader: SourceReader,
  timeLeft: () => boolean,
): Promise<StreamRun> {
  const totals: Totals = { upserted: 0, skipped: 0, testSlug: 0, excluded: 0 };
  const seen = new Set<string>();
  let after: string | null = null;
  for (;;) {
    if (!timeLeft()) return { done: false, totals, seen };
    const rows = await reader.ballotsAfter(after, BALLOT_BATCH);
    if (rows.length === 0) break;
    rows.forEach((r) => seen.add(r.id));
    const stats = await writeBatch(scope, state, (db) => applyBallots(db, scope, rows), null);
    totals.upserted += stats.upserted;
    totals.skipped += stats.skipped;
    totals.testSlug += stats.details?.testSlug ?? 0;
    totals.excluded += stats.details?.excluded ?? 0;
    after = rows[rows.length - 1].id;
    if (rows.length < BALLOT_BATCH) break;
  }
  await withSystemOrgTx(scope.organizationId, ({ db }) =>
    markStream(db, state, { total: seen.size } as Prisma.InputJsonValue, 0),
  );
  return { done: true, totals, seen };
}

export interface SyncRunSummary {
  streams: Partial<Record<Stream, Totals & { done?: number }>>;
  reconciled: boolean;
  complete: boolean;
}

/**
 * The sync itself, given an open reader: exported so the database tests can
 * drive it against the local stand-in without the job runner.
 */
export async function runSync(
  loaded: Loaded,
  reader: SourceReader,
  options: { deadline: number; stream: string; now?: () => number },
): Promise<SyncRunSummary> {
  const now = options.now ?? Date.now;
  const timeLeft = () => options.deadline - now() > SAFETY_MS;
  const { scope, states } = loaded;
  const state = (s: Stream) => {
    const row = states.get(s);
    if (!row) throw new Error(`missing sync state ${s}`);
    return row;
  };
  const summary: SyncRunSummary = { streams: {}, reconciled: false, complete: true };
  const only = (s: Stream) => options.stream === "all" || options.stream === "reconcile" || options.stream === s;

  const guard = async (s: Stream, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (error) {
      if (error instanceof StaleWatermarkError) {
        summary.complete = false;
        return;
      }
      const message = sanitize(error, 300);
      await withSystemOrgTx(scope.organizationId, ({ db }) => recordStreamError(db, state(s), message)).catch(
        () => undefined,
      );
      throw error;
    }
  };

  if (only("sessions") && timeLeft()) {
    await guard("sessions", async () => {
      const sessions = await reader.sessions();
      const stats = await withSystemOrgTx(scope.organizationId, async (ctx) => {
        const out = await applySessions({ ...ctx, organizationId: scope.organizationId }, scope, sessions);
        await markStream(ctx.db, state("sessions"), { total: sessions.length } as Prisma.InputJsonValue, out.created + out.linked + out.updated);
        if (out.created + out.linked + out.updated + out.unlinked > 0) await markDataChanged(ctx.db, scope.organizationId);
        return out;
      });
      summary.streams.sessions = { ...stats };
    });
  }

  if (only("signups")) {
    await guard("signups", async () => {
      const r = await keysetStream({
        stream: "signups",
        scope,
        state: state("signups"),
        fetch: (after) => reader.signupsSince(after),
        apply: (db, rows) => applySignups(db, scope, rows),
        tsOf: (row) => new Date(row.updated_at),
        timeLeft,
      });
      summary.streams.signups = r.totals;
      if (!r.done) summary.complete = false;
    });
  }

  if (only("checkins")) {
    await guard("checkins", async () => {
      const r = await keysetStream({
        stream: "checkins",
        scope,
        state: state("checkins"),
        fetch: (after) => reader.checkinsSince(after),
        apply: (db, rows) => applyCheckins(db, scope, rows),
        tsOf: (row) => new Date(row.created_at),
        timeLeft,
        isUnmapped: (row) => mapCheckinSource(row.source).unmapped,
      });
      summary.streams.checkins = r.totals;
      if (!r.done) summary.complete = false;
    });
  }

  let ballotIds: Set<string> | undefined;
  if (only("ballots")) {
    await guard("ballots", async () => {
      const r = await ballotsStream(scope, state("ballots"), reader, timeLeft);
      summary.streams.ballots = r.totals;
      if (r.done) ballotIds = r.seen;
      else summary.complete = false;
    });
  }

  if (only("unsubscribes") && timeLeft()) {
    await guard("unsubscribes", async () => {
      const rows = await reader.unsubscribes();
      const stats = await writeBatch(scope, state("unsubscribes"), (db) => applyUnsubscribes(db, scope, rows), {
        full: { total: rows.length } as Prisma.InputJsonValue,
      });
      summary.streams.unsubscribes = { upserted: stats.upserted, skipped: stats.skipped };
    });
  }

  const due =
    options.stream === "reconcile" ||
    (options.stream === "all" &&
      (!loaded.lastReconcileAt || now() - loaded.lastReconcileAt.getTime() > RECONCILE_EVERY_MS));
  if (due && summary.complete && timeLeft()) {
    await guard("reconcile", async () => {
      const checkins = await keysetStream({
        stream: "checkins",
        scope,
        state: state("checkins"),
        fetch: (after) => reader.checkinsSince(after),
        apply: (db, rows) => applyCheckins(db, scope, rows),
        tsOf: (row) => new Date(row.created_at),
        timeLeft,
        reconcile: true,
      });
      const signups = checkins.done
        ? await keysetStream({
            stream: "signups",
            scope,
            state: state("signups"),
            fetch: (after) => reader.signupsSince(after),
            apply: (db, rows) => applySignups(db, scope, rows),
            tsOf: (row) => new Date(row.updated_at),
            timeLeft,
            reconcile: true,
          })
        : { done: false, totals: {}, seen: undefined };
      if (!checkins.done || !signups.done || !ballotIds) {
        summary.complete = false;
        return;
      }
      const removed = await withSystemOrgTx(scope.organizationId, async ({ db }) => {
        const a = await removeMissing(db, scope.organizationId, "checkins", checkins.seen ?? new Set());
        const s = await removeMissing(db, scope.organizationId, "signups", signups.seen ?? new Set());
        const b = await removeMissing(db, scope.organizationId, "ballots", ballotIds ?? new Set());
        await refreshRollups(db, scope.organizationId, null);
        await markDataChanged(db, scope.organizationId);
        await markStream(
          db,
          state("reconcile"),
          { lastAt: new Date(now()).toISOString(), removed: a.removed + s.removed + b.removed } as Prisma.InputJsonValue,
          0,
        );
        return { checkins: a.removed, signups: s.removed, ballots: b.removed };
      });
      summary.streams.reconcile = removed;
      summary.reconciled = true;
    });
  }
  return summary;
}

export const sourceSyncJob: JobHandler<SourceSyncPayload> = async (run): Promise<JobOutcome | void> => {
  const orgId = run.organizationId;
  if (!orgId) throw new PermanentJobError("source-sync is an org job");
  const { integrationId, stream } = run.payload;

  const loaded = await loadSyncContext(orgId, integrationId);
  if (!loaded) return { status: "CANCELLED", error: "The website data source is not set up." };

  let config;
  try {
    config = parseSourceConfig(loaded.config);
  } catch (error) {
    const reason = error instanceof SourceConfigError ? error.message : "Invalid data source settings.";
    await recordIntegration(orgId, integrationId, reason);
    throw new PermanentJobError(reason);
  }
  const password = await getSecret({ orgId, integrationId, kind: "DB_PASSWORD" });
  if (!password) return { status: "CANCELLED", error: "No reader password is saved." };

  let client: pg.Client;
  try {
    client = await openSourceClient(config, password);
  } catch (error) {
    await recordIntegration(orgId, integrationId, describeConnectionError(error));
    throw new Error(describeConnectionError(error));
  }

  let summary: SyncRunSummary;
  try {
    const reader = sourceReader(client);
    const version = await reader.contractVersion();
    if (!(SUPPORTED_CONTRACT_VERSIONS as readonly number[]).includes(version)) {
      const reason = `The website export is version ${version}; this suite understands version 1.`;
      await recordIntegration(orgId, integrationId, reason);
      throw new PermanentJobError(reason);
    }
    summary = await runSync(loaded, reader, { deadline: run.deadline, stream });
  } catch (error) {
    if (!(error instanceof PermanentJobError)) {
      await recordIntegration(orgId, integrationId, describeConnectionError(error)).catch(() => undefined);
    }
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }

  await recordIntegration(orgId, integrationId, null);
  if (!summary.complete) {
    // Out of budget (or another run moved a watermark): continue next time
    // under the coalesced key.
    await withSystemOrgTx(orgId, ({ db }) =>
      requestSync(db, orgId, integrationId, { reconcile: stream === "reconcile", noKick: true }),
    );
  }
  console.info(`[source-sync] ${orgId} ${stream} ${JSON.stringify(summary.streams)}`);
};
