import { createHash, randomBytes } from "node:crypto";

import { Role, TransactionKind, TransactionStatus } from "@/generated/prisma/client";
import { appUrl } from "@/lib/app-url";
import { formatCents } from "@/lib/finance/money";
import { isEmailEnabled } from "@/lib/notification-preferences";
import { authDb } from "@/server/db/clients";
import { withSystemOrgTx } from "@/server/db/context";
import type { EMAIL_JOB_TEMPLATES } from "@/server/jobs/registry";
import { PermanentJobError, type JobHandler } from "@/server/jobs/types";
import { renderTaskNotificationEmail } from "@/server/tasks/email";

import { getOrgMailer, getPlatformMailer } from "./mailer";
import {
  invitationEmail,
  notificationEmail,
  reimbursementStatusEmail,
  treasurerDigestEmail,
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
  if (!isEmailEnabled(n.user.emailPreferences, n.type)) return;

  // Task notifications (Phase 6) render their own templates: title, who
  // assigned it, due date, a direct link. "skip" means it no longer applies.
  const taskEmail = await renderTaskNotificationEmail(orgId, n);
  if (taskEmail === "skip") return;

  const mailer = await getOrgMailer(orgId);
  if (!mailer) return; // in-app only for this org

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
        acceptUrl: appUrl(`/invite/${token}`),
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
  if (!mailer) return;
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
): Promise<void> {
  const data = await withSystemOrgTx(orgId, async ({ db }) => {
    const recipient = await db.membership.findFirst({
      where: { organizationId: orgId, userId, role: { in: [Role.OWNER, Role.TREASURER] } },
      select: {
        user: { select: { email: true } },
        organization: { select: { name: true, slug: true } },
      },
    });
    if (!recipient) return null; // no longer a treasurer or owner
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
  if (!mailer) return;
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
        verifyUrl: appUrl(`/verify-email/${token}`),
        expiresHours: VERIFY_EMAIL_TTL_HOURS,
      }),
    },
    { signal: run.signal },
  );
};
