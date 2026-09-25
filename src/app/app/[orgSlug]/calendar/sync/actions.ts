"use server";

import { withOrgAction } from "@/server/db/context";
import { requestGoogleImport, requestGoogleSync } from "@/server/google-calendar/requests";

import { actionError } from "../action-result";

/**
 * Calendar > Sync and website feed. ADMIN+ (integrations.write), checked in
 * the request functions; the work runs in gcal / google-import jobs after
 * commit (the import is a heavy job, kicked to /api/cron/jobs).
 */

interface Result {
  error?: string;
  queued?: number;
}

const syncNowTx = withOrgAction(async (ctx): Promise<Result> => {
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

const importTx = withOrgAction(async (ctx, mode: "dry-run" | "apply"): Promise<Result> => {
  if (mode !== "dry-run" && mode !== "apply") return { error: "Unknown import mode." };
  const result = await requestGoogleImport(ctx, mode);
  return result.ok ? {} : { error: result.error };
});

/** "Import existing events": the dry run, then applying it. */
export async function importGoogleEvents(organizationId: string, mode: "dry-run" | "apply"): Promise<Result> {
  try {
    return await importTx(organizationId, mode);
  } catch (error) {
    return actionError(error);
  }
}
