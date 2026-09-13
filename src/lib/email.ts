import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.EMAIL_FROM ?? "CBC Portal <no-reply@example.com>";

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
