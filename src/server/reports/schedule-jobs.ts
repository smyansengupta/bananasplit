import { NotificationType, Prisma } from "@/generated/prisma/client";
import { appUrl } from "@/lib/app-url";
import { NotFoundError } from "@/lib/auth/errors";
import { spaceIncludes } from "@/lib/billing/space";
import { safeTimeZone } from "@/lib/calendar/dates";
import { isEmailEnabled } from "@/lib/notification-prefs";
import { isSendDay, readSchedule } from "@/lib/reports/schedule";
import { weekdayOfKey } from "@/lib/tasks/dates";
import { withOrgTxAs, withSystemOrgTx } from "@/server/db/context";
import { getOrgMailer } from "@/server/email/mailer";
import { reportEmail } from "@/server/email/report";
import { enqueueJob } from "@/server/jobs/enqueue";
import { PermanentJobError, type JobHandler, type JobOutcome } from "@/server/jobs/types";
import { nextOccurrence, type TriggerMode } from "@/server/tasks/schedule";

import { reportViewer, runReport } from "./run";
import { getReport, takeSnapshot } from "./saved";

/**
 * Saved reports on a schedule (Report.schedule, src/lib/reports/schedule.ts).
 *
 * scheduleReportSends, per org from /api/cron/task-digest (the same hourly
 * and daily triggers as the pulse), enqueues report-send:{reportId}:{date}
 * once for each report due that day.
 *
 * report-send keeps a copy of the report as its maker sees it (Past
 * reports) and enqueues one report-email per recipient.
 *
 * report-email computes the report AS THE RECIPIENT (withOrgTxAs: their own
 * RLS context, so their own rows and their own access to the report) and
 * emails it, unless they turned scheduled reports off. A recipient who
 * can't open the report any more gets nothing.
 *
 * Acting as a member from a job is what withOrgTxAs is for; this module is
 * on its ESLint allowlist (REPORT_JOBS), and only ever acts as the report's
 * maker or a member the schedule names.
 */

function requireOrg(orgId: string | null): string {
  if (!orgId) throw new PermanentJobError("org job without an organizationId");
  return orgId;
}

export async function scheduleReportSends(
  organizationId: string,
  now: Date,
  mode: TriggerMode,
): Promise<number> {
  return withSystemOrgTx(organizationId, async ({ db }) => {
    const org = await db.organization.findUnique({
      where: { id: organizationId },
      select: {
        kind: true,
        plan: true,
        trialEndsAt: true,
        planAfterTrial: true,
        timezone: true,
        deletedAt: true,
      },
    });
    if (!org || org.deletedAt || !spaceIncludes(org, "reports", now)) return 0;
    const tz = safeTimeZone(org.timezone);
    const reports = await db.report.findMany({
      where: { organizationId, archivedAt: null, schedule: { not: Prisma.DbNull } },
      select: { id: true, schedule: true },
      take: 200,
    });
    let queued = 0;
    for (const r of reports) {
      const schedule = readSchedule(r.schedule);
      if (!schedule) continue;
      const at = nextOccurrence(now, tz, schedule.hour, mode, (d) =>
        isSendDay(schedule, d, weekdayOfKey(d)),
      );
      if (!at) continue;
      const id = await enqueueJob(db, {
        orgId: organizationId,
        kind: "report-send",
        key: `${r.id}:${at.dateKey}`,
        payload: { reportId: r.id, sendKey: at.dateKey },
        runAt: at.runAt,
        once: true,
        noKick: true,
      });
      if (id) queued += 1;
    }
    return queued;
  });
}

export const reportSendJob: JobHandler<{ reportId: string; sendKey: string }> = async (
  run,
): Promise<JobOutcome | void> => {
  const orgId = requireOrg(run.organizationId);
  const { reportId, sendKey } = run.payload;
  const found = await withSystemOrgTx(orgId, async ({ db }) => {
    const report = await db.report.findFirst({
      where: { id: reportId, organizationId: orgId, archivedAt: null },
      select: { createdById: true, schedule: true, access: true },
    });
    if (!report?.createdById) return null;
    const schedule = readSchedule(report.schedule);
    if (!schedule) return null;
    let others: { userId: string }[] = [];
    if (report.access === "ORGANIZATION" && schedule.to !== "me") {
      others = await db.membership.findMany({
        where: {
          organizationId: orgId,
          ...(schedule.to === "admins" ? { role: { in: ["OWNER", "ADMIN"] } } : {}),
        },
        select: { userId: true },
      });
    }
    return {
      maker: report.createdById,
      recipients: [...new Set([report.createdById, ...others.map((m) => m.userId)])],
    };
  });
  if (!found)
    return { status: "CANCELLED", error: "the report is gone, archived or not scheduled" };

  // The copy, as its maker sees it.
  try {
    await withOrgTxAs(found.maker, orgId, async (ctx) => {
      const v = await reportViewer(ctx);
      const report = await getReport(ctx.db, orgId, reportId);
      const result = await runReport(v, report, {});
      if (!result.source) return;
      await takeSnapshot(
        v,
        report,
        result.source.name,
        result.range.span ?? result.range.label,
        result.computed,
      );
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return { status: "CANCELLED", error: "its maker is no longer a member" };
    }
    throw error;
  }

  await withSystemOrgTx(orgId, async ({ db }) => {
    for (const userId of found.recipients) {
      await enqueueJob(db, {
        orgId,
        kind: "report-email",
        key: `${reportId}:${sendKey}:${userId}`,
        payload: { reportId, userId },
        once: true,
      });
    }
  });
};

export const reportEmailJob: JobHandler<{ reportId: string; userId: string }> = async (
  run,
): Promise<JobOutcome | void> => {
  const orgId = requireOrg(run.organizationId);
  const { reportId, userId } = run.payload;
  const member = await withSystemOrgTx(orgId, ({ db }) =>
    db.membership.findFirst({
      where: { organizationId: orgId, userId },
      select: {
        user: { select: { email: true, emailPreferences: true } },
        organization: { select: { name: true, slug: true } },
      },
    }),
  );
  if (!member) return { status: "CANCELLED", error: "no longer a member" };
  if (!isEmailEnabled(member.user.emailPreferences, NotificationType.REPORT_SENT)) {
    return { status: "CANCELLED", error: "the recipient turned this email off" };
  }

  let email;
  try {
    email = await withOrgTxAs(userId, orgId, async (ctx) => {
      const v = await reportViewer(ctx);
      const report = await getReport(ctx.db, orgId, reportId);
      const result = await runReport(v, report, {});
      if (!result.source) return null;
      return reportEmail({
        orgName: member.organization.name,
        title: report.title,
        sourceName: result.source.name,
        rangeLabel: result.range.label,
        computed: result.computed,
        url: appUrl(`/app/${member.organization.slug}/databases/reports/${reportId}`),
      });
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return { status: "CANCELLED", error: "the recipient can't open this report" };
    }
    throw error;
  }
  if (!email)
    return { status: "CANCELLED", error: "the recipient can't see the report's database" };

  const mailer = await getOrgMailer(orgId);
  if (!mailer) return { status: "CANCELLED", error: "no email sender for this org" };
  await mailer.send(
    { to: member.user.email, ...email },
    { signal: run.signal, idempotencyKey: `report-email-${run.id}` },
  );
};
