"use server";

import { requirePermission } from "@/lib/auth/permissions";
import { writeOrgAuditLog } from "@/server/audit";
import { withOrgAction } from "@/server/db/context";
import { requestGoogleImport, requestGoogleSync } from "@/server/google-calendar/requests";
import { enqueueJob } from "@/server/jobs/enqueue";

import { actionError } from "../action-result";

/** Every action here belongs to integrations (withOrgAction's space check). */
const integrationsAction: typeof withOrgAction = (handler, options) =>
  withOrgAction(handler, { onRefused: "return", ...options, feature: "integrations" });

/**
 * Calendar > Sync and website feed (and its import card on Settings >
 * Integrations > Google Calendar). ADMIN+ (integrations.write), checked in
 * the request functions; the work runs in gcal / google-import jobs after
 * commit (the import is a heavy job, kicked to /api/cron/jobs).
 */

interface Result {
  error?: string;
  queued?: number;
}

const syncNowTx = integrationsAction(async (ctx): Promise<Result> => {
  const result = await requestGoogleSync(ctx);
  return result.ok ? { queued: result.queued ?? 0 } : { error: result.error };
});

/** "Sync now": retry failed and pending mirrors and push anything missing. */
export async function syncGoogleNow(organizationId: string): Promise<Result> {
  try {
    return await syncNowTx(organizationId);
  } catch (error) {
    return actionError(error);
  }
}

const importTx = integrationsAction(async (ctx, mode: "dry-run" | "apply"): Promise<Result> => {
  if (mode !== "dry-run" && mode !== "apply") return { error: "Unknown import mode." };
  const result = await requestGoogleImport(ctx, mode);
  return result.ok ? {} : { error: result.error };
});

/** "Import existing events": the dry run, then applying it. */
export async function importGoogleEvents(
  organizationId: string,
  mode: "dry-run" | "apply",
): Promise<Result> {
  try {
    return await importTx(organizationId, mode);
  } catch (error) {
    return actionError(error);
  }
}

const retryEventTx = integrationsAction(async (ctx, eventId: string): Promise<Result> => {
  requirePermission(ctx, "events.write");
  if (typeof eventId !== "string" || eventId.length > 100) return { error: "Unknown event." };
  const event = await ctx.db.event.findFirst({
    where: { id: eventId, organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true, googleSyncState: true },
  });
  if (!event) return { error: "That event no longer exists." };
  if (event.googleSyncState !== "FAILED") return { error: "It's on Google already." };
  // PENDING first, raw, as the backfill does (marking a row is not an edit).
  await ctx.db.$executeRaw`
    UPDATE "Event" SET "googleSyncState" = 'PENDING'::"CalendarSyncState"
     WHERE "organizationId" = ${ctx.organizationId} AND "id" = ${event.id}`;
  await enqueueJob(ctx.db, {
    orgId: ctx.organizationId,
    kind: "gcal",
    key: event.id,
    payload: { eventId: event.id },
  });
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: "event.google_sync_retried",
    targetType: "Event",
    targetId: event.id,
  });
  return { queued: 1 };
});

/**
 * "Retry sync" on one event that didn't reach Google Calendar (its page,
 * and its line on Calendar > Sync): the same gcal job a save queues.
 * Owners and admins, like every change to an event.
 */
export async function retryGoogleSync(organizationId: string, eventId: string): Promise<Result> {
  try {
    return await retryEventTx(organizationId, eventId);
  } catch (error) {
    return actionError(error);
  }
}
