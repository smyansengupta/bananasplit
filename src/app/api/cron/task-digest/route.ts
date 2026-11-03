import { NextResponse } from "next/server";

import { assertCronAuth } from "@/server/cron/auth";
import { scheduleCrmAi } from "@/server/crm/ai-jobs";
import { scheduleCrmRefresh } from "@/server/crm/schedule";
import { serviceDb } from "@/server/db/clients";
import { sanitize } from "@/server/jobs/sanitize";
import { schedulePulse } from "@/server/pulse/schedule";
import { scheduleReportSends } from "@/server/reports/schedule-jobs";
import { scheduleOrgTaskJobs, type TriggerMode } from "@/server/tasks/schedule";

/**
 * Enqueues the daily task digests, the weekly-update reminders and the
 * due-today and overdue reminders (src/server/tasks/schedule.ts), and each
 * club's weekly pulse (src/server/pulse/schedule.ts), and the CRM's
 * nightly upkeep (src/server/crm/schedule.ts). It never sends
 * anything itself: the job drain (/api/cron/jobs) runs the task-digest,
 * weekly-update-reminder, task-reminder and weekly-pulse jobs.
 *
 *   GET /api/cron/task-digest              hourly trigger (Vercel Pro cron,
 *                                          or the GitHub Actions pinger)
 *   GET /api/cron/task-digest?mode=daily   the Hobby daily-cron fallback:
 *                                          schedules the next 24 hours ahead
 *
 * Both are idempotent (once=true keys per local date and week) and may run
 * together. Fails closed without CRON_SECRET.
 */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = assertCronAuth(request);
  if (denied) return denied;

  const mode: TriggerMode =
    new URL(request.url).searchParams.get("mode") === "daily" ? "daily" : "hourly";
  const now = new Date();
  const orgIds = await serviceDb.$queryRaw<
    { id: string }[]
  >`SELECT id FROM app.active_org_ids() AS id`;

  let digests = 0;
  let weeklyReminders = 0;
  let dueReminders = 0;
  let pulses = 0;
  let reports = 0;
  let crm = 0;
  let failed = 0;
  for (const { id: orgId } of orgIds) {
    try {
      const summary = await scheduleOrgTaskJobs(orgId, now, mode);
      digests += summary.digests;
      weeklyReminders += summary.weeklyReminders;
      dueReminders += summary.dueReminders;
    } catch (error) {
      failed += 1;
      console.error("[cron] task-digest failed for one org", sanitize(error));
    }
    try {
      pulses += (await schedulePulse(orgId, now, mode)).pulses;
    } catch (error) {
      failed += 1;
      console.error("[cron] weekly pulse scheduling failed for one org", sanitize(error));
    }
    try {
      reports += await scheduleReportSends(orgId, now, mode);
    } catch (error) {
      failed += 1;
      console.error("[cron] report schedules failed for one org", sanitize(error));
    }
    try {
      crm += await scheduleCrmRefresh(orgId, now);
      crm += await scheduleCrmAi(orgId, now);
    } catch (error) {
      failed += 1;
      console.error("[cron] CRM upkeep scheduling failed for one org", sanitize(error));
    }
  }

  return NextResponse.json(
    { mode, orgs: orgIds.length, digests, weeklyReminders, dueReminders, pulses, reports, crm, failed },
    { headers: { "Cache-Control": "no-store" } },
  );
}
