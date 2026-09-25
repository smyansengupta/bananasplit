import { escapeHtml, safeHref, subjectLine } from "./escape";

/**
 * Email templates. Each returns { subject, html, text }. Every interpolated
 * value is escaped, every link is an absolute NEXT_PUBLIC_APP_URL link
 * (built with appUrl by the caller) passed through safeHref, and every
 * message has a plain-text part.
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface LayoutInput {
  subject: string;
  /** Small line above the body, e.g. the org name. */
  eyebrow?: string;
  /** Pre-escaped HTML paragraphs. */
  bodyHtml: string;
  /** Plain-text body. */
  bodyText: string;
  cta?: { label: string; url: string };
  footer?: string;
}

const PRODUCT = "CBC Portal";

export function layout(input: LayoutInput): RenderedEmail {
  const subject = subjectLine(input.subject);
  const footer = input.footer ?? `You're receiving this because of your account on ${PRODUCT}.`;
  const cta = input.cta
    ? `<p style="margin:24px 0"><a href="${safeHref(input.cta.url)}" style="display:inline-block;background:#18181b;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">${escapeHtml(input.cta.label)}</a></p>
<p style="margin:0 0 16px;font-size:12px;color:#71717a">Or paste this link into your browser:<br><span style="word-break:break-all">${escapeHtml(input.cta.url)}</span></p>`
    : "";
  const eyebrow = input.eyebrow
    ? `<p style="margin:0 0 16px;font-size:12px;letter-spacing:.02em;color:#71717a">${escapeHtml(input.eyebrow)}</p>`
    : "";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b;line-height:1.5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px"><tr><td style="padding:28px 28px 20px">
${eyebrow}${input.bodyHtml}${cta}
<p style="margin:24px 0 0;font-size:12px;color:#71717a">${escapeHtml(footer)}</p>
</td></tr></table>
</td></tr></table>
</body></html>`;

  const textParts = [
    input.eyebrow,
    input.bodyText,
    input.cta ? `${input.cta.label}: ${input.cta.url}` : undefined,
    footer,
  ];
  return { subject, html, text: textParts.filter(Boolean).join("\n\n") };
}

export function paragraph(text: string): string {
  return `<p style="margin:0 0 12px">${escapeHtml(text)}</p>`;
}

/** The email copy of an in-app notification. */
export function notificationEmail(input: {
  orgName: string;
  title: string;
  body?: string | null;
  url?: string | null;
}): RenderedEmail {
  return layout({
    subject: input.title,
    eyebrow: input.orgName,
    bodyHtml: `<p style="margin:0 0 12px;font-size:16px;font-weight:600">${escapeHtml(input.title)}</p>${input.body ? paragraph(input.body) : ""}`,
    bodyText: [input.title, input.body].filter(Boolean).join("\n\n"),
    cta: input.url ? { label: "Open in CBC Portal", url: input.url } : undefined,
    footer: "Change which notifications email you in Settings > Notifications.",
  });
}

export function invitationEmail(input: {
  orgName: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
  expiresAt: Date;
}): RenderedEmail {
  const role = input.role.toLowerCase();
  const expires = input.expiresAt.toUTCString().replace(/ GMT$/, " UTC");
  return layout({
    subject: `${input.inviterName} invited you to ${input.orgName} on ${PRODUCT}`,
    eyebrow: input.orgName,
    bodyHtml:
      `<p style="margin:0 0 12px">${escapeHtml(input.inviterName)} invited you to join <strong>${escapeHtml(input.orgName)}</strong> as ${escapeHtml(role)}.</p>` +
      paragraph(
        `This invitation expires ${expires}. Sign in with this email address to accept it.`,
      ),
    bodyText: `${input.inviterName} invited you to join ${input.orgName} as ${role}.\n\nThis invitation expires ${expires}. Sign in with this email address to accept it.`,
    cta: { label: "Accept invitation", url: input.acceptUrl },
    footer: "If you weren't expecting this invitation, you can ignore this email.",
  });
}

const STATUS_COPY: Record<string, string> = {
  APPROVED: "was approved",
  REJECTED: "was rejected",
  REIMBURSED: "was marked reimbursed",
};

export function reimbursementStatusEmail(input: {
  orgName: string;
  description: string;
  status: "APPROVED" | "REJECTED" | "REIMBURSED";
  rejectionReason?: string | null;
  url: string;
}): RenderedEmail {
  const summary = STATUS_COPY[input.status] ?? "was updated";
  const reason =
    input.status === "REJECTED" && input.rejectionReason ? input.rejectionReason : null;
  return layout({
    subject: `Your expense "${input.description}" ${summary}`,
    eyebrow: input.orgName,
    bodyHtml:
      `<p style="margin:0 0 12px">Your expense <strong>${escapeHtml(input.description)}</strong> ${escapeHtml(summary)}.</p>` +
      (reason ? paragraph(`Reason: ${reason}`) : ""),
    bodyText: `Your expense "${input.description}" ${summary}.${reason ? `\n\nReason: ${reason}` : ""}`,
    cta: { label: "View your reimbursements", url: input.url },
  });
}

export function treasurerDigestEmail(input: {
  orgName: string;
  pending: { description: string; amountFormatted: string; submitterName: string }[];
  url: string;
}): RenderedEmail {
  const n = input.pending.length;
  const items = input.pending
    .map(
      (p) =>
        `<li style="margin:0 0 6px">${escapeHtml(p.description)} &mdash; ${escapeHtml(p.amountFormatted)} <span style="color:#71717a">(${escapeHtml(p.submitterName)})</span></li>`,
    )
    .join("");
  return layout({
    subject: `${n} expense${n === 1 ? "" : "s"} awaiting your review in ${input.orgName}`,
    eyebrow: input.orgName,
    bodyHtml:
      paragraph(`These expenses are waiting on a treasurer or owner in ${input.orgName}:`) +
      `<ul style="margin:0 0 12px;padding-left:20px">${items}</ul>`,
    bodyText: `These expenses are waiting on a treasurer or owner in ${input.orgName}:\n\n${input.pending
      .map((p) => `- ${p.description} — ${p.amountFormatted} (${p.submitterName})`)
      .join("\n")}`,
    cta: { label: "Review expenses", url: input.url },
  });
}

export function verifyEmailEmail(input: {
  name?: string | null;
  verifyUrl: string;
  expiresHours: number;
}): RenderedEmail {
  const greeting = input.name ? `Hi ${input.name},` : "Hi,";
  return layout({
    subject: `Confirm your email for ${PRODUCT}`,
    bodyHtml:
      paragraph(greeting) +
      paragraph(
        `Confirm this address to finish setting up your ${PRODUCT} account. The link expires in ${input.expiresHours} hours.`,
      ),
    bodyText: `${greeting}\n\nConfirm this address to finish setting up your ${PRODUCT} account. The link expires in ${input.expiresHours} hours.`,
    cta: { label: "Confirm email", url: input.verifyUrl },
    footer:
      "If you didn't create an account, you can ignore this email; the account is removed after 72 hours.",
  });
}

/** Settings > Integrations > Email: 'Send test email'. */
export function testEmail(input: { orgName: string; senderLabel: string }): RenderedEmail {
  return layout({
    subject: `Test email from ${input.orgName}`,
    eyebrow: input.orgName,
    bodyHtml: paragraph(
      `This is a test email from ${input.orgName} on ${PRODUCT}, sent through ${input.senderLabel}. If you received it, the sender works.`,
    ),
    bodyText: `This is a test email from ${input.orgName} on ${PRODUCT}, sent through ${input.senderLabel}. If you received it, the sender works.`,
  });
}
