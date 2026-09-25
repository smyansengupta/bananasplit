import { after, NextResponse } from "next/server";

import { assertCronAuth } from "@/server/cron/auth";
import { drainJobs } from "@/server/jobs/drain";
import { scheduleDailyMaintenance } from "@/server/jobs/maintenance";
import { isJobKind } from "@/server/jobs/registry";
import { sanitize } from "@/server/jobs/sanitize";

/**
 * The job drain ('Background jobs' decision, item 8).
 *
 * GET  (Vercel Cron, the GitHub Actions pinger): enqueue today's platform
 *      maintenance, then drain due jobs within the budget, at most one
 *      heavy job, and answer with the summary.
 * POST ?kind=<kind> (the kick from an enqueuing request): answer 202 at once
 *      and drain that kind in this invocation's after(), inside its own
 *      300s maxDuration.
 *
 * Fails closed: 503 without CRON_SECRET, 401 without the bearer secret.
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Leave room for the response and the last finish_job under maxDuration. */
const BUDGET_MS = 270_000;

export async function GET(request: Request) {
  const denied = assertCronAuth(request);
  if (denied) return denied;

  try {
    await scheduleDailyMaintenance();
  } catch (error) {
    console.error("[jobs] scheduling maintenance failed", sanitize(error));
  }
  const summary = await drainJobs({ budgetMs: BUDGET_MS });
  return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const denied = assertCronAuth(request);
  if (denied) return denied;

  const kind = new URL(request.url).searchParams.get("kind");
  if (kind !== null && !isJobKind(kind)) {
    return NextResponse.json({ error: "unknown kind" }, { status: 400 });
  }
  after(async () => {
    try {
      await drainJobs({ budgetMs: BUDGET_MS, kinds: kind ? [kind] : undefined });
    } catch (error) {
      console.error("[jobs] kicked drain failed", sanitize(error));
    }
  });
  return NextResponse.json({ accepted: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
