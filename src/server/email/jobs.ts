import { createHash, randomBytes } from "node:crypto";

import { Role, TransactionKind, TransactionStatus } from "@/generated/prisma/client";
import { appUrl } from "@/lib/app-url";
import { trialDaysLeft, trialFallbackName, trialPlanName } from "@/lib/billing/space";
import { formatCents } from "@/lib/finance/money";
import { isEmailEnabled } from "@/lib/notification-preferences";
import { authDb } from "@/server/db/clients";
import { withSystemOrgTx } from "@/server/db/context";
import type { EMAIL_JOB_TEMPLATES } from "@/server/jobs/registry";
import { PermanentJobError, type JobHandler, type JobOutcome } from "@/server/jobs/types";
import { renderTaskNotificationEmail } from "@/server/tasks/email";

import { getOrgMailer, getPlatformMailer } from "./mailer";
import { hashResetToken, PASSWORD_RESET_TTL_MINUTES } from "./password-reset";
import {
  invitationEmail,
  notificationEmail,
  passwordChangedEmail,
  passwordResetEmail,
  reimbursementStatusEmail,
  treasurerDigestEmail,
  trialEndingEmail,
  verifyEmailEmail,
} from "./templates";

/**
 * Handlers for the email job kinds (registry rows: email, notify-email,
 * invite-email, reimbursement-email, verify-email). Each follows the
 * job-runner contract: short service transactions to read and to mark, the
 * send itself with no transaction open, and an idempotency guard so a lost
 * lease does not email twice (Notification.emailSentAt compare-and-set; a
 * Resend idempotency key for the rest).
 */

function requireOrg(orgId: string | null): string {
  if (!orgId) throw new PermanentJobError("org job without an organizationId");
  return orgId;
}

/**
 * The outcome when the org gets in-app notifications only. CANCELLED with
 * the reason, not DONE: a job that sent nothing must not look like a
 * delivered email in the Job table, and the log line says what to change.
 */
function noSender(orgId: string, kind: string): JobOutcome {
  console.warn(
    `[email] ${kind} not sent: org ${orgId} has no email sender (connect one under Admin panel › Integrations › Email sender, or turn on the platform fallback there)`,
  );
  return { status: "CANCELLED", error: "no email sender for this org (in-app only)" };
}

/** notify-email:{notificationId} — the email copy of a Notification. */
export const notifyEmailJob: JobHandler<{ notificationId: string }> = async (run) => {
  const orgId = requireOrg(run.organizationId);
  const id = run.payload.notificationId;

  const n = await withSystemOrgTx(orgId, ({ db }) =>
    db.notification.findFirst({
      where: { id, organizationId: orgId },
      select: {
        userId: true,
        type: true,
        title: true,
        body: true,
        linkUrl: true,
        emailSentAt: true,
        taskId: true,
        actorId: true,
        dedupeKey: true,
        user: { select: { email: true, emailPreferences: true } },
        organization: { select: { name: true } },
      },
    }),
  );
  if (!n || n.emailSentAt) return; // gone, or already sent
  if (!isEmailEnabled(n.user.emailPreferences, n.type)) {
    return { status: "CANCELLED", error: "the recipient turned this email off" };
  }

  // Task notifications (Phase 6) render their own templates: title, who
  // assigned it, due date, a direct link. "skip" means it no longer applies.
  const taskEmail = await renderTaskNotificationEmail(orgId, n);
  if (taskEmail === "skip") return { status: "CANCELLED", error: "no longer applies" };

  const mailer = await getOrgMailer(orgId);
  if (!mailer) return noSender(orgId, "notify-email");

  // Claim the send (at most once), then send outside any transaction; a
  // failed send releases the claim so the retry can send.
  const stamp = new Date();
  const claimed = await withSystemOrgTx(orgId, ({ db }) =>
    db.notification.updateMany({ where: { id, emailSentAt: null }, data: { emailSentAt: stamp } }),
  );
  if (claimed.count === 0) return;

  try {
    await mailer.send(
      {
        to: n.user.email,
        ...(taskEmail ??
          notificationEmail({
            orgName: n.organization.name,
            title: n.title,
            body: n.body,
            url: n.linkUrl ? appUrl(n.linkUrl) : null,
          })),
      },
      { signal: run.signal, idempotencyKey: `notify-email-${id}` },
    );
  } catch (error) {
    await withSystemOrgTx(orgId, ({ db }) =>
      db.notification.updateMany({
        where: { id, emailSentAt: stamp },
        data: { emailSentAt: null },
      }),
    );
    throw error;
  }
};

/**
 * invite-email:{invitationId}. The database stores only the token's hash, so
 * the accept link is minted here: a fresh token replaces the stored hash
 * just before the send (a retry mints another; only the delivered link
 * works). Invitations use the org's sender, else the platform sender.
 */
export const inviteEmailJob: JobHandler<{ invitationId: string }> = async (run) => {
  const orgId = requireOrg(run.organizationId);
  const id = run.payload.invitationId;
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  // Before the hash is replaced, so a missing app URL fails the job without
  // invalidating a link already delivered.
  const acceptUrl = appUrl(`/invite/${token}`);

  const invite = await withSystemOrgTx(orgId, async ({ db }) => {
    const row = await db.invitation.findFirst({
      where: { id, organizationId: orgId },
      select: {
        email: true,
        role: true,
        expiresAt: true,
        acceptedAt: true,
        invitedBy: { select: { name: true, email: true } },
        organization: { select: { name: true } },
      },
    });
    if (!row || row.acceptedAt || row.expiresAt <= new Date()) return null;
    await db.invitation.update({ where: { id }, data: { token: tokenHash } });
    return row;
  });
  if (!invite) return;

  const mailer = (await getOrgMailer(orgId)) ?? getPlatformMailer();
  await mailer.send(
    {
      to: invite.email,
      ...invitationEmail({
        orgName: invite.organization.name,
        inviterName: invite.invitedBy.name ?? invite.invitedBy.email,
        role: invite.role,
        acceptUrl,
        expiresAt: invite.expiresAt,
      }),
    },
    { signal: run.signal },
  );
};

/** reimbursement-email:{transactionId}:{status} — to the expense's submitter. */
export const reimbursementEmailJob: JobHandler<{
  transactionId: string;
  status: "APPROVED" | "REJECTED" | "REIMBURSED";
}> = async (run) => {
  const orgId = requireOrg(run.organizationId);
  const { transactionId, status } = run.payload;

  const t = await withSystemOrgTx(orgId, ({ db }) =>
    db.transaction.findFirst({
      where: { id: transactionId, organizationId: orgId },
      select: {
        description: true,
        status: true,
        rejectionReason: true,
        submittedBy: { select: { email: true } },
        organization: { select: { name: true, slug: true } },
      },
    }),
  );
  // Stale: the expense moved on (or vanished) before the mail went out.
  if (!t || t.status !== status) return;

  const mailer = await getOrgMailer(orgId);
  if (!mailer) return noSender(orgId, "reimbursement-email");
  await mailer.send(
    {
      to: t.submittedBy.email,
      ...reimbursementStatusEmail({
        orgName: t.organization.name,
        description: t.description,
        status,
        rejectionReason: t.rejectionReason,
        url: appUrl(`/app/${t.organization.slug}/finance/my-reimbursements`),
      }),
    },
    { signal: run.signal, idempotencyKey: `reimbursement-email-${transactionId}-${status}` },
  );
};

type EmailTemplate = (typeof EMAIL_JOB_TEMPLATES)[number];

/** email — a templated org email to one member (the generic outbox kind). */
export const emailJob: JobHandler<{
  template: EmailTemplate;
  toUserId: string;
  refs?: Record<string, string>;
}> = async (run) => {
  const orgId = requireOrg(run.organizationId);
  switch (run.payload.template) {
    case "treasurer-digest":
      return sendTreasurerDigest(orgId, run.payload.toUserId, run.signal, run.dedupeKey);
    default:
      throw new PermanentJobError(`unknown email template ${String(run.payload.template)}`);
  }
};

async function sendTreasurerDigest(
  orgId: string,
  userId: string,
  signal: AbortSignal,
  dedupeKey: string,
): Promise<JobOutcome | void> {
  const data = await withSystemOrgTx(orgId, async ({ db }) => {
    const recipient = await db.membership.findFirst({
      where: {
        organizationId: orgId,
        userId,
        role: { in: [Role.OWNER, Role.ADMIN, Role.TREASURER] },
      },
      select: {
        user: { select: { email: true } },
        organization: { select: { name: true, slug: true } },
      },
    });
    if (!recipient) return null; // no longer an owner, admin or treasurer
    const pending = await db.transaction.findMany({
      where: {
        organizationId: orgId,
        kind: TransactionKind.EXPENSE,
        status: TransactionStatus.SUBMITTED,
        voidedAt: null,
      },
      orderBy: { occurredAt: "asc" },
      take: 50,
      select: {
        description: true,
        amountCents: true,
        submittedBy: { select: { name: true, email: true } },
      },
    });
    return { recipient, pending };
  });
  if (!data || data.pending.length === 0) return;

  const mailer = await getOrgMailer(orgId);
  if (!mailer) return noSender(orgId, "treasurer-digest");
  const org = data.recipient.organization;
  await mailer.send(
    {
      to: data.recipient.user.email,
      ...treasurerDigestEmail({
        orgName: org.name,
        pending: data.pending.map((p) => ({
          description: p.description,
          amountFormatted: formatCents(p.amountCents),
          submitterName: p.submittedBy.name ?? p.submittedBy.email,
        })),
        url: appUrl(`/app/${org.slug}/finance/transactions?status=SUBMITTED`),
      }),
    },
    { signal, idempotencyKey: dedupeKey.replace(/[^A-Za-z0-9_-]/g, "-") },
  );
}

/** How long an email-verification link stays valid. */
export const VERIFY_EMAIL_TTL_HOURS = 24;

/**
 * verify-email:{userId} — a platform job (app_auth enqueues it at sign-up).
 * Mints a verification token (only its sha256 is stored, in
 * VerificationToken, identifier = the email) and sends the link through the
 * platform sender. A verified or deleted user is a no-op.
 */
export const verifyEmailJob: JobHandler<{ userId: string }> = async (run) => {
  const user = await authDb.user.findUnique({
    where: { id: run.payload.userId },
    select: { email: true, name: true, emailVerified: true },
  });
  if (!user || user.emailVerified) return;

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  // Built before any write: without a usable app URL (AppUrlConfigError in
  // production) the job fails with that message and the user's current link
  // is left alone, instead of mailing a link to localhost.
  const verifyUrl = appUrl(`/verify-email/${token}`);
  await authDb.$transaction([
    authDb.verificationToken.deleteMany({ where: { identifier: user.email } }),
    authDb.verificationToken.create({
      data: {
        identifier: user.email,
        token: tokenHash,
        expires: new Date(Date.now() + VERIFY_EMAIL_TTL_HOURS * 60 * 60 * 1000),
      },
    }),
  ]);

  await getPlatformMailer().send(
    {
      to: user.email,
      ...verifyEmailEmail({
        name: user.name,
        verifyUrl,
        expiresHours: VERIFY_EMAIL_TTL_HOURS,
      }),
    },
    { signal: run.signal },
  );
};

/**
 * password-reset-email:{userId} — a platform job (app_auth enqueues it from
 * "Forgot your password?"). Mints a reset token (only its sha256 is stored,
 * in PasswordResetToken), replacing any earlier link, and mails it through
 * the platform sender. A deleted user is a no-op. No idempotency key: a
 * second run mints a new link, and replaying the first email would send a
 * link that no longer works.
 */
export const passwordResetEmailJob: JobHandler<{ userId: string }> = async (run) => {
  const user = await authDb.user.findUnique({
    where: { id: run.payload.userId },
    select: { id: true, email: true, name: true },
  });
  if (!user) return;

  const token = randomBytes(32).toString("base64url");
  // Built before any write, as in verifyEmailJob: no usable app URL fails
  // the job instead of mailing a link to localhost.
  const resetUrl = appUrl(`/reset-password/${token}`);
  await authDb.$transaction([
    authDb.passwordResetToken.deleteMany({ where: { userId: user.id } }),
    authDb.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashResetToken(token),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000),
      },
    }),
  ]);

  await getPlatformMailer().send(
    {
      to: user.email,
      ...passwordResetEmail({
        name: user.name,
        resetUrl,
        expiresMinutes: PASSWORD_RESET_TTL_MINUTES,
      }),
    },
    { signal: run.signal },
  );
};

/** password-changed-email:{userId} — the notice after a reset (platform sender). */
export const passwordChangedEmailJob: JobHandler<{ userId: string }> = async (run) => {
  const user = await authDb.user.findUnique({
    where: { id: run.payload.userId },
    select: { email: true, name: true },
  });
  if (!user) return;
  await getPlatformMailer().send(
    {
      to: user.email,
      ...passwordChangedEmail({ name: user.name, resetUrl: appUrl("/forgot-password") }),
    },
    { signal: run.signal },
  );
};

/**
 * trial-reminder-email:{orgId} — "Your free trial is almost up", to each
 * owner (platform sender). Enqueued when the space is made, to run
 * TRIAL_NOTICE_DAYS before the trial ends (scheduleTrialReminder). Nothing
 * is sent once the trial has ended, a plan was picked, or the space is
 * closing.
 */
export const trialReminderEmailJob: JobHandler<Record<string, never>> = async (run) => {
  const orgId = requireOrg(run.organizationId);
  const data = await withSystemOrgTx(orgId, async ({ db }) => {
    const org = await db.organization.findUnique({
      where: { id: orgId },
      select: {
        name: true,
        slug: true,
        kind: true,
        plan: true,
        trialEndsAt: true,
        planAfterTrial: true,
        timezone: true,
        deletedAt: true,
      },
    });
    if (!org || org.deletedAt) return null;
    const owners = await db.membership.findMany({
      where: { organizationId: orgId, role: Role.OWNER },
      select: { userId: true, user: { select: { email: true, name: true } } },
    });
    return { org, owners };
  });
  if (!data?.org.trialEndsAt) return;
  const { org, owners } = data;
  const trialEndsAt = data.org.trialEndsAt;
  const daysLeft = trialDaysLeft(org);
  if (!daysLeft) return; // ended, or a plan was picked
  const personal = org.kind === "PERSONAL";
  const endsOn = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: org.timezone,
  }).format(trialEndsAt);
  const mailer = getPlatformMailer();
  for (const owner of owners) {
    await mailer.send(
      {
        to: owner.user.email,
        ...trialEndingEmail({
          name: owner.user.name,
          orgName: personal ? null : org.name,
          trialPlan: trialPlanName(org),
          freePlan: trialFallbackName(org),
          picked: org.planAfterTrial === "CLUB" || org.planAfterTrial === "SOCIETY",
          daysLeft,
          endsOn,
          url: appUrl(`/app/${org.slug}/settings/plan`),
        }),
      },
      { signal: run.signal, idempotencyKey: `trial-reminder-${orgId}-${owner.userId}` },
    );
  }
};
