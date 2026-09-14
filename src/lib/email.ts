import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.EMAIL_FROM ?? "CBC Portal <no-reply@example.com>";

/** Generic email for the in-app notification center (spec 6.1). */
export async function sendNotificationEmail(params: {
  to: string;
  title: string;
  body?: string;
}): Promise<void> {
  if (!resend) {
    console.warn(`[email] RESEND_API_KEY not set — skipping notification email: "${params.title}"`);
    return;
  }
  await resend.emails.send({
    from: FROM,
    to: params.to,
    subject: params.title,
    html: `<p>${params.title}</p>${params.body ? `<p>${params.body}</p>` : ""}`,
  });
}

export async function sendInvitationEmail(params: {
  to: string;
  orgName: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
}): Promise<void> {
  if (!resend) {
    console.warn(
      `[email] RESEND_API_KEY not set — skipping invitation email to ${params.to}. Accept link: ${params.acceptUrl}`,
    );
    return;
  }
  await resend.emails.send({
    from: FROM,
    to: params.to,
    subject: `${params.inviterName} invited you to ${params.orgName} on CBC Portal`,
    html: `
      <p>${params.inviterName} invited you to join <strong>${params.orgName}</strong> as ${params.role.toLowerCase()}.</p>
      <p><a href="${params.acceptUrl}">Accept invitation</a></p>
      <p>This invite expires in 7 days.</p>
    `,
  });
}

const STATUS_COPY: Record<string, string> = {
  APPROVED: "was approved",
  REJECTED: "was rejected",
  REIMBURSED: "was marked reimbursed",
};

/** Fires on the expense status transition itself (spec 5.11) — never on a generic row edit. */
export async function sendReimbursementStatusEmail(params: {
  to: string;
  description: string;
  status: string;
  rejectionReason?: string | null;
}): Promise<void> {
  const summary = STATUS_COPY[params.status];
  if (!summary) return;

  if (!resend) {
    console.warn(
      `[email] RESEND_API_KEY not set — skipping reimbursement status email to ${params.to}: "${params.description}" ${summary}.`,
    );
    return;
  }
  await resend.emails.send({
    from: FROM,
    to: params.to,
    subject: `Your expense "${params.description}" ${summary}`,
    html: `
      <p>Your expense <strong>${params.description}</strong> ${summary}.</p>
      ${params.rejectionReason ? `<p>Reason: ${params.rejectionReason}</p>` : ""}
      <p>Sign in to CBC Portal to see the details.</p>
    `,
  });
}

/** Weekly digest to treasurers/owners of expenses awaiting their action (spec 5.11). */
export async function sendTreasurerDigestEmail(params: {
  to: string;
  orgName: string;
  pending: { description: string; amountFormatted: string; submitterName: string }[];
}): Promise<void> {
  if (params.pending.length === 0) return;

  if (!resend) {
    console.warn(
      `[email] RESEND_API_KEY not set — skipping treasurer digest to ${params.to} (${params.pending.length} pending).`,
    );
    return;
  }
  await resend.emails.send({
    from: FROM,
    to: params.to,
    subject: `${params.pending.length} expense(s) awaiting your review in ${params.orgName}`,
    html: `
      <p>These expenses are waiting on a treasurer or owner in <strong>${params.orgName}</strong>:</p>
      <ul>
        ${params.pending
          .map((p) => `<li>${p.description} — ${p.amountFormatted} (${p.submitterName})</li>`)
          .join("")}
      </ul>
    `,
  });
}
