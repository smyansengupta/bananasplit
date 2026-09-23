import { getPlatformMailer } from "@/server/email/mailer";
import {
  invitationEmail,
  notificationEmail,
  reimbursementStatusEmail,
  treasurerDigestEmail,
} from "@/server/email/templates";
import { appUrl } from "@/lib/app-url";

/**
 * Legacy entry points, kept as thin wrappers over src/server/email: the same
 * signatures, now with escaped templates, absolute links, checked Resend
 * results and the dev sink (console + .data/mail/) when no key is set.
 *
 * These send IMMEDIATELY through the platform sender. App code should not
 * call them any more: it enqueues through the outbox instead, so nothing is
 * sent for a rolled-back write and no action waits on Resend
 * (notifyUser -> notify-email, invitations -> invite-email, expense status
 * -> reimbursement-email, digests -> email; see src/server/email/index.ts).
 */

function absolute(url: string | undefined): string | null {
  if (!url) return null;
  return url.startsWith("/") ? appUrl(url) : url;
}

/** Generic email for the in-app notification center (spec 6.1). */
export async function sendNotificationEmail(params: {
  to: string;
  title: string;
  body?: string;
  linkUrl?: string;
  orgName?: string;
}): Promise<void> {
  await getPlatformMailer().send({
    to: params.to,
    ...notificationEmail({
      orgName: params.orgName ?? "CBC Portal",
      title: params.title,
      body: params.body,
      url: absolute(params.linkUrl),
    }),
  });
}

export async function sendInvitationEmail(params: {
  to: string;
  orgName: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
  expiresAt?: Date;
}): Promise<void> {
  await getPlatformMailer().send({
    to: params.to,
    ...invitationEmail({
      orgName: params.orgName,
      inviterName: params.inviterName,
      role: params.role,
      acceptUrl: absolute(params.acceptUrl) ?? params.acceptUrl,
      expiresAt: params.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    }),
  });
}

/** Fires on the expense status transition itself (spec 5.11) — never on a generic row edit. */
export async function sendReimbursementStatusEmail(params: {
  to: string;
  description: string;
  status: string;
  rejectionReason?: string | null;
  orgName?: string;
  url?: string;
}): Promise<void> {
  if (params.status !== "APPROVED" && params.status !== "REJECTED" && params.status !== "REIMBURSED") {
    return;
  }
  await getPlatformMailer().send({
    to: params.to,
    ...reimbursementStatusEmail({
      orgName: params.orgName ?? "CBC Portal",
      description: params.description,
      status: params.status,
      rejectionReason: params.rejectionReason,
      url: absolute(params.url) ?? appUrl("/app"),
    }),
  });
}

/** Weekly digest to treasurers/owners of expenses awaiting their action (spec 5.11). */
export async function sendTreasurerDigestEmail(params: {
  to: string;
  orgName: string;
  pending: { description: string; amountFormatted: string; submitterName: string }[];
  url?: string;
}): Promise<void> {
  if (params.pending.length === 0) return;
  await getPlatformMailer().send({
    to: params.to,
    ...treasurerDigestEmail({
      orgName: params.orgName,
      pending: params.pending,
      url: absolute(params.url) ?? appUrl("/app"),
    }),
  });
}
