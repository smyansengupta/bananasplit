import {
  CalendarSyncState,
  EventVisibility,
  IntegrationProvider,
  IntegrationStatus,
  type Prisma,
  type Role,
} from "@/generated/prisma/client";
import { requirePermission } from "@/lib/auth/permissions";
import { writeOrgAuditLog } from "@/server/audit";
import type { TxClient } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";

import { loadGoogleIntegration, mergeIntegrationConfig, type GoogleCalendarConfig } from "./config";
import type { ImportRecord } from "./import";

/**
 * What admins can ask of the Google mirror, and what they see of it. Called
 * from Server Actions (the Calendar > Sync page, and Settings > Integrations)
 * with the action's ctx: the work is queued in the caller's transaction and
 * runs in the gcal / google-import jobs after commit.
 */

const DAY = 24 * 60 * 60 * 1000;
/** "Sync now" and the post-import backfill reach back this far. */
export const BACKFILL_LOOKBACK_DAYS = 30;
export const BACKFILL_LIMIT = 500;

/**
 * Queues gcal for every event whose mirror is not where it should be:
 * live PUBLIC (and, with an internal calendar, INTERNAL) events that are not
 * SYNCED to their calendar, plus any mirror left PENDING or FAILED
 * (deletions and moves included), plus INTERNAL mirrors when there is no
 * longer an internal calendar. Returns how many were queued.
 */
export async function enqueueGoogleBackfill(
  db: TxClient,
  organizationId: string,
  config: GoogleCalendarConfig,
  opts: { now?: Date; limit?: number } = {},
): Promise<number> {
  const since = new Date((opts.now ?? new Date()).getTime() - BACKFILL_LOOKBACK_DAYS * DAY);
  const live = {
    deletedAt: null,
    mergedIntoId: null,
    endsAt: { gte: since },
  } satisfies Prisma.EventWhereInput;
  const or: Prisma.EventWhereInput[] = [
    {
      ...live,
      visibility: EventVisibility.PUBLIC,
      NOT: { googleSyncState: CalendarSyncState.SYNCED, googleCalendarId: config.publicCalendarId },
    },
    {
      googleEventId: { not: null },
      googleSyncState: { in: [CalendarSyncState.PENDING, CalendarSyncState.FAILED] },
    },
  ];
  if (config.internalCalendarId) {
    or.push({
      ...live,
      visibility: EventVisibility.INTERNAL,
      NOT: {
        googleSyncState: CalendarSyncState.SYNCED,
        googleCalendarId: config.internalCalendarId,
      },
    });
  } else {
    or.push({ visibility: EventVisibility.INTERNAL, googleEventId: { not: null } });
  }
  const rows = await db.event.findMany({
    where: { organizationId, OR: or },
    select: { id: true },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    take: opts.limit ?? BACKFILL_LIMIT,
  });
  if (rows.length === 0) return 0;
  const ids = rows.map((r) => r.id);
  // Raw: marking a row PENDING is not an edit, so updatedAt stays.
  await db.$executeRaw`
    UPDATE "Event" SET "googleSyncState" = 'PENDING'::"CalendarSyncState"
     WHERE "organizationId" = ${organizationId} AND "id" = ANY(${ids}::text[])`;
  for (const id of ids) {
    await enqueueJob(db, {
      orgId: organizationId,
      kind: "gcal",
      key: id,
      payload: { eventId: id },
    });
  }
  return ids.length;
}

export interface RequestContext {
  db: TxClient;
  organizationId: string;
  userId: string;
  role: Role | null;
}

export type RequestResult = { ok: true; queued?: number } | { ok: false; error: string };

function usable(status: IntegrationStatus): string | null {
  if (status === IntegrationStatus.CONNECTED || status === IntegrationStatus.ERROR) return null;
  if (status === IntegrationStatus.NEEDS_REAUTH)
    return "Reconnect Google Calendar in Settings > Integrations first.";
  return "Connect Google Calendar in Settings > Integrations first.";
}

/** "Sync now": retry failed and pending mirrors and push anything missing. ADMIN+. */
export async function requestGoogleSync(ctx: RequestContext): Promise<RequestResult> {
  requirePermission(ctx, "integrations.write");
  const integration = await loadGoogleIntegration(ctx.db, ctx.organizationId);
  if (!integration)
    return { ok: false, error: "Connect Google Calendar in Settings > Integrations first." };
  const blocked = usable(integration.status);
  if (blocked) return { ok: false, error: blocked };
  const queued = await enqueueGoogleBackfill(ctx.db, ctx.organizationId, integration.config);
  await mergeIntegrationConfig(ctx.db, integration.id, {
    lastSyncRequestAt: new Date().toISOString(),
  });
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: "calendar.google_sync_requested",
    targetType: "OrgIntegration",
    targetId: integration.id,
    diff: { queued },
  });
  return { ok: true, queued };
}

/** "Import existing events": a dry run, or applying it. ADMIN+. */
export async function requestGoogleImport(
  ctx: RequestContext,
  mode: "dry-run" | "apply",
): Promise<RequestResult> {
  requirePermission(ctx, "integrations.write");
  const integration = await loadGoogleIntegration(ctx.db, ctx.organizationId);
  if (!integration)
    return { ok: false, error: "Connect Google Calendar in Settings > Integrations first." };
  const blocked = usable(integration.status);
  if (blocked) return { ok: false, error: blocked };
  if (mode === "apply") {
    const last = integration.rawConfig.import as Partial<ImportRecord> | undefined;
    if (!last || last.mode !== "dry-run" || last.status === "failed") {
      return { ok: false, error: "Run the dry run first and review what it would do." };
    }
  }
  await enqueueJob(ctx.db, {
    orgId: ctx.organizationId,
    kind: "google-import",
    key: `${integration.id}:${mode}`,
    payload: { integrationId: integration.id, mode },
  });
  await mergeIntegrationConfig(ctx.db, integration.id, {
    import: {
      ...((integration.rawConfig.import as object | undefined) ?? {}),
      requested: mode,
      requestedAt: new Date().toISOString(),
    },
  });
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: "calendar.google_import_requested",
    targetType: "OrgIntegration",
    targetId: integration.id,
    diff: { mode },
  });
  return { ok: true };
}

export interface SyncFailure {
  id: string;
  title: string;
  error: string | null;
  startsAt: Date;
}

/** config.import as the Sync page reads it. */
export type ImportState = Partial<ImportRecord> & {
  requested?: string;
  requestedAt?: string;
  appliedAt?: string;
  applied?: number;
};

export interface GoogleSyncStatus {
  google: {
    status: IntegrationStatus;
    lastError: string | null;
    publicCalendarId: string;
    internalCalendarId: string | null;
    lastSyncRequestAt: string | null;
    import: ImportState | null;
  } | null;
  counts: Record<CalendarSyncState, number>;
  failures: SyncFailure[];
  buildHook: {
    status: IntegrationStatus;
    lastError: string | null;
    lastVerifiedAt: Date | null;
  } | null;
  publicEventsEnabled: boolean;
}

/** The Calendar > Sync page's data. ADMIN+ (integrations are admin-only under RLS too). */
export async function getGoogleSyncStatus(
  ctx: Omit<RequestContext, "userId">,
): Promise<GoogleSyncStatus> {
  requirePermission(ctx, "integrations.view");
  const { db, organizationId } = ctx;
  const integration = await loadGoogleIntegration(db, organizationId);
  const grouped = await db.event.groupBy({
    by: ["googleSyncState"],
    where: { organizationId, deletedAt: null, mergedIntoId: null },
    _count: { _all: true },
  });
  const counts = {
    NOT_APPLICABLE: 0,
    PENDING: 0,
    SYNCED: 0,
    FAILED: 0,
  } as Record<CalendarSyncState, number>;
  for (const g of grouped) counts[g.googleSyncState] = g._count._all;
  const failures = await db.event.findMany({
    where: { organizationId, googleSyncState: CalendarSyncState.FAILED },
    select: { id: true, title: true, googleSyncError: true, startsAt: true },
    orderBy: { startsAt: "asc" },
    take: 20,
  });
  const hook = await db.orgIntegration.findUnique({
    where: {
      organizationId_provider: { organizationId, provider: IntegrationProvider.NETLIFY_BUILD_HOOK },
    },
    select: { status: true, lastError: true, lastVerifiedAt: true },
  });
  const settings = await db.orgSettings.findUnique({
    where: { organizationId },
    select: { publicEventsEnabled: true },
  });
  return {
    google: integration
      ? {
          status: integration.status,
          lastError: integration.lastError,
          publicCalendarId: integration.config.publicCalendarId,
          internalCalendarId: integration.config.internalCalendarId,
          lastSyncRequestAt:
            typeof integration.rawConfig.lastSyncRequestAt === "string"
              ? integration.rawConfig.lastSyncRequestAt
              : null,
          import: (integration.rawConfig.import as ImportState | undefined) ?? null,
        }
      : null,
    counts,
    failures: failures.map((f) => ({
      id: f.id,
      title: f.title,
      error: f.googleSyncError,
      startsAt: f.startsAt,
    })),
    buildHook: hook,
    publicEventsEnabled: settings?.publicEventsEnabled === true,
  };
}
