import { randomUUID } from "node:crypto";

import { NotificationType, type Prisma } from "@/generated/prisma/client";
import { appUrl } from "@/lib/app-url";
import { spaceIncludes } from "@/lib/billing/space";
import { safeTimeZone } from "@/lib/calendar/dates";
import { isEmailEnabled } from "@/lib/notification-prefs";
import { parsePulseData, pulseHeadline, pulseTitle } from "@/lib/pulse/data";
import { pulseRecipients } from "@/lib/pulse/settings";
import { addDaysToKey, isDateKey } from "@/lib/tasks/dates";
import { withSystemOrgTx } from "@/server/db/context";
import { getOrgMailer } from "@/server/email/mailer";
import { pulseEmail } from "@/server/email/pulse";
import { enqueueJob } from "@/server/jobs/enqueue";
import { PermanentJobError, type JobHandler, type JobOutcome } from "@/server/jobs/types";

import { loadPulseFinance, seesPulseFinance } from "./finance";
import { compilePulseData } from "./generate";
import { writePulseSummary } from "./summary";

/**
 * The pulse's job kinds (registry rows weekly-pulse and pulse-email).
 *
 * weekly-pulse:{weekStart}, once per week at the club's pulse time
 * (./schedule.ts):
 *   1. compile the week and upsert the issue, keeping an admin's note;
 *   2. Team Advanced: Claude's two-sentence summary, with no transaction
 *      open (network I/O), stored in the data;
 *   3. in one transaction: mark it sent with a compare-and-set on sentAt
 *      (a lost lease can't send twice), write the WEEKLY_PULSE
 *      notifications (pulseInApp; deduped per issue) and one pulse-email
 *      job per recipient (pulseEmail, unless they turned it off).
 *
 * pulse-email:{issueId}:{userId} renders the email for that recipient (with
 * "Money moved" only for a finance role, checked at send time) and sends it
 * through the club's sender with a Resend idempotency key.
 */

function requireOrg(orgId: string | null): string {
  if (!orgId) throw new PermanentJobError("org job without an organizationId");
  return orgId;
}

export function pulseIssuePath(orgSlug: string, weekStart: string): string {
  return `/app/${orgSlug}/pulse/${weekStart}`;
}

export const weeklyPulseJob: JobHandler<{ weekStart: string }> = async (
  run,
): Promise<JobOutcome | void> => {
  const orgId = requireOrg(run.organizationId);
  const { weekStart } = run.payload;
  if (!isDateKey(weekStart)) throw new PermanentJobError("weekStart is not a date");
  const range = { from: weekStart, to: addDaysToKey(weekStart, 6) };
  const weekDate = new Date(`${weekStart}T00:00:00.000Z`);
  const now = new Date();

  // 1. Compile and store (the draft, if one was written, keeps its note).
  const compiled = await withSystemOrgTx(orgId, async ({ db }) => {
    const org = await db.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        name: true,
        slug: true,
        kind: true,
        plan: true,
        trialEndsAt: true,
        timezone: true,
        deletedAt: true,
        settings: {
          select: { pulseEnabled: true, pulseAudience: true, pulseEmail: true, pulseInApp: true },
        },
      },
    });
    if (!org || org.deletedAt || org.kind !== "CLUB" || !org.settings?.pulseEnabled) return null;
    if (!spaceIncludes(org, "overview", now)) return null;
    const existing = await db.pulseIssue.findUnique({
      where: { organizationId_weekStart: { organizationId: orgId, weekStart: weekDate } },
      select: { id: true, sentAt: true, data: true },
    });
    if (existing?.sentAt) return { org, issueId: existing.id, sent: true as const, data: null };
    const data = await compilePulseData(db, orgId, range, safeTimeZone(org.timezone), now);
    // A retry keeps the summary it already wrote.
    const summary = parsePulseData(existing?.data)?.summary;
    if (summary) data.summary = summary;
    const json = data as unknown as Prisma.InputJsonValue;
    const issue = await db.pulseIssue.upsert({
      where: { organizationId_weekStart: { organizationId: orgId, weekStart: weekDate } },
      create: { organizationId: orgId, weekStart: weekDate, data: json },
      update: { data: json },
      select: { id: true },
    });
    return { org, issueId: issue.id, sent: false as const, data };
  });
  if (!compiled) return { status: "CANCELLED", error: "the pulse is off for this organization" };
  if (compiled.sent) return;
  const { org, issueId, data } = compiled;

  // 2. The summary (Team Advanced), outside any transaction.
  if (!data.summary) {
    const summary = await writePulseSummary(org, data, now);
    if (summary) {
      data.summary = summary;
      await withSystemOrgTx(orgId, ({ db }) =>
        db.pulseIssue.updateMany({
          where: { id: issueId, sentAt: null },
          data: { data: data as unknown as Prisma.InputJsonValue },
        }),
      );
    }
  }

  // 3. Send: claim it, then notify and queue the emails in the same transaction.
  const settings = org.settings!;
  await withSystemOrgTx(orgId, async ({ db }) => {
    const claimed = await db.pulseIssue.updateMany({
      where: { id: issueId, sentAt: null },
      data: { sentAt: new Date() },
    });
    if (claimed.count === 0) return;
    const members = await db.membership.findMany({
      where: { organizationId: orgId },
      select: { userId: true, role: true, user: { select: { emailPreferences: true } } },
    });
    const recipients = pulseRecipients(settings, members, (m) =>
      isEmailEnabled(m.user.emailPreferences, NotificationType.WEEKLY_PULSE),
    );
    const link = pulseIssuePath(org.slug, weekStart);
    if (recipients.inApp.length > 0) {
      await db.notification.createMany({
        data: recipients.inApp.map((userId) => ({
          id: randomUUID(),
          organizationId: orgId,
          userId,
          type: NotificationType.WEEKLY_PULSE,
          title: `Weekly pulse: ${pulseTitle(data.range)}`,
          body: pulseHeadline(data),
          linkUrl: link,
          dedupeKey: `pulse:${issueId}`,
        })),
        skipDuplicates: true,
      });
    }
    for (const userId of recipients.email) {
      await enqueueJob(db, {
        orgId,
        kind: "pulse-email",
        key: `${issueId}:${userId}`,
        payload: { issueId, userId },
        noKick: true,
      });
    }
  });
};

export const pulseEmailJob: JobHandler<{ issueId: string; userId: string }> = async (
  run,
): Promise<JobOutcome | void> => {
  const orgId = requireOrg(run.organizationId);
  const { issueId, userId } = run.payload;

  const prepared = await withSystemOrgTx(orgId, async ({ db }) => {
    const issue = await db.pulseIssue.findFirst({
      where: { id: issueId, organizationId: orgId },
      select: { weekStart: true, data: true, note: true, sentAt: true },
    });
    if (!issue?.sentAt) return { skip: "the issue is gone or not sent" } as const;
    const data = parsePulseData(issue.data);
    if (!data) throw new PermanentJobError("the issue's data is not a shape this version reads");
    const member = await db.membership.findFirst({
      where: { organizationId: orgId, userId },
      select: {
        role: true,
        user: { select: { email: true, emailPreferences: true } },
        organization: { select: { name: true, slug: true, timezone: true } },
      },
    });
    if (!member) return { skip: "no longer a member" } as const;
    if (!isEmailEnabled(member.user.emailPreferences, NotificationType.WEEKLY_PULSE)) {
      return { skip: "the recipient turned this email off" } as const;
    }
    const finance = seesPulseFinance(member.role)
      ? await loadPulseFinance(
          db,
          orgId,
          data.range,
          safeTimeZone(member.organization.timezone),
          new Date(),
        )
      : null;
    return {
      to: member.user.email,
      email: pulseEmail({
        orgName: member.organization.name,
        data,
        note: issue.note,
        finance,
        issueUrl: appUrl(pulseIssuePath(member.organization.slug, data.range.from)),
      }),
    } as const;
  });
  if ("skip" in prepared) return { status: "CANCELLED", error: prepared.skip };

  const mailer = await getOrgMailer(orgId);
  if (!mailer) {
    console.warn(`[email] pulse-email not sent: org ${orgId} has no email sender`);
    return { status: "CANCELLED", error: "no email sender for this org (in-app only)" };
  }
  await mailer.send(
    { to: prepared.to, ...prepared.email },
    { signal: run.signal, idempotencyKey: `pulse-email-${issueId}-${userId}` },
  );
};
