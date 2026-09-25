import { NextResponse } from "next/server";

import { hasCronAuth } from "@/server/cron/auth";
import { runHealthChecks } from "@/server/health";

/**
 * Health and deploy-safety check (spec 6.6; 0A preview isolation; 0B role,
 * session-default and manifest checks; see src/server/health.ts).
 *
 * Unauthenticated callers (the uptime monitor, the Playwright smoke test)
 * get only { status: "ok" } with 200, or { status: "error" } with 503. With
 * `Authorization: Bearer <CRON_SECRET>` the response also lists each check
 * and why it failed. Failures are always logged server-side.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const report = await runHealthChecks();
  if (!report.ok) {
    const failed = report.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail ?? "failed"}`);
    console.error(`[health] failing checks: ${failed.join(" | ")}`);
  }
  const body = hasCronAuth(request)
    ? { status: report.ok ? "ok" : "error", checks: report.checks }
    : { status: report.ok ? "ok" : "error" };
  return NextResponse.json(body, {
    status: report.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
