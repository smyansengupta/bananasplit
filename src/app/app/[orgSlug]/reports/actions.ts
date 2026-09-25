"use server";

import { refresh } from "next/cache";

import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { requirePermission } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { checkRateLimit, rateLimitKey, retryAfterText } from "@/lib/rate-limit";
import { invalidate } from "@/server/cache/invalidate";
import { reports as reportsTag } from "@/server/cache/tags";
import { withOrgAction } from "@/server/db/context";

export type RefreshReportsResult = { ok: true } | { ok: false; error: string };

const REFRESH_LIMIT = 12;
const REFRESH_WINDOW_SECONDS = 60;

/**
 * The Reports "Refresh" button: drops the org's cached reports (after the
 * membership check commits: invalidate() queues on the action's transaction
 * and runs updateTag after COMMIT) and refreshes the client router, so the
 * next render recomputes every card. Any member may refresh; it is
 * rate-limited per user and org because each refresh recomputes seven
 * reports.
 */
export async function refreshReports(organizationId: string): Promise<RefreshReportsResult> {
  const user = await requireUser();
  const limit = await checkRateLimit(
    rateLimitKey("reports-refresh", user.id, organizationId),
    REFRESH_LIMIT,
    REFRESH_WINDOW_SECONDS,
  );
  if (!limit.allowed)
    return { ok: false, error: `Too many refreshes. Try again ${retryAfterText(limit)}.` };

  try {
    await withOrgAction(async (ctx) => {
      requirePermission(ctx, "reports.view");
      invalidate([reportsTag(ctx.organizationId)], { mode: "action" });
    })(organizationId);
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) {
      return { ok: false, error: "You can't refresh reports for this organization." };
    }
    throw error;
  }
  refresh();
  return { ok: true };
}
