import { appOrigin } from "@/lib/app-url";

import { escapeHtml, safeHref, subjectLine } from "./escape";

/**
 * Email templates. Each returns { subject, html, text }. Every interpolated
 * value is escaped, every link is an absolute NEXT_PUBLIC_APP_URL link
 * (built with appUrl by the caller) passed through safeHref, and every
 * message has a plain-text part that says the same as the HTML.
 *
 * The look is Moonstone's light palette in fixed colours (mail clients have
 * no CSS variables, and most ignore dark-mode CSS): a white card on a soft
 * grey page, ink text, sentence case, and an ink pill with white type for
 * the one action. The logo is the standard lockup, exactly as it is
 * (public/brand/bananasplit-logo.svg, served as a PNG because Gmail and
 * Outlook don't show SVG images).
 */

/** Moonstone light (globals.css :root), as literals for mail clients. */
export const EMAIL_COLORS = {
  page: "#eff1f4",
  card: "#ffffff",
  line: "#e3e6e9",
  ink: "#111318",
  muted: "#63656a",
  onInk: "#ffffff",
} as const;

const C = EMAIL_COLORS;
const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Helvetica,Arial,sans-serif";

/** The lockup's width and height in the email (the PNG is 4x). */
const LOGO = { path: "/brand/bananasplit-logo.png", width: 140, height: 28 } as const;

/** The app's origin for the logo, or null when there is none (the logo is then left out). */
function logoOrigin(): string | null {
  try {
    return appOrigin();
  } catch {
    return null;
  }
}

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

const PRODUCT = "Bananasplit";

export function layout(input: LayoutInput): RenderedEmail {
  const subject = subjectLine(input.subject);
  const footer = input.footer ?? `You're receiving this because of your account on ${PRODUCT}.`;
  const cta = input.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 18px"><tr><td style="border-radius:999px;background:${C.ink}"><a href="${safeHref(input.cta.url)}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:${C.ink};color:${C.onInk};font-size:15px;font-weight:600;line-height:1.2;text-decoration:none">${escapeHtml(input.cta.label)}</a></td></tr></table>
<p style="margin:0;font-size:13px;line-height:1.5;color:${C.muted}">Or paste this link into your browser:<br><span style="word-break:break-all;color:${C.ink}">${escapeHtml(input.cta.url)}</span></p>`
    : "";
  const eyebrow = input.eyebrow
    ? `<p style="margin:0 0 14px;font-size:13px;font-weight:500;line-height:1.4;color:${C.muted}">${escapeHtml(input.eyebrow)}</p>`
    : "";
  const origin = logoOrigin();
  const logo = origin
    ? `<tr><td style="padding:0 4px 20px"><a href="${safeHref(`${origin}/`)}" style="text-decoration:none"><img src="${safeHref(`${origin}${LOGO.path}`)}" width="${LOGO.width}" height="${LOGO.height}" alt="${PRODUCT}" style="display:block;border:0;outline:none;width:${LOGO.width}px;height:${LOGO.height}px"></a></td></tr>`
    : "";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.page};font-family:${FONT};color:${C.ink};font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page}"><tr><td align="center" style="padding:32px 12px 40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
${logo}<tr><td style="background:${C.card};border:1px solid ${C.line};border-radius:24px;padding:32px 30px 30px">
${eyebrow}${input.bodyHtml}${cta}
</td></tr>
<tr><td style="padding:18px 4px 0;font-size:12px;line-height:1.5;color:${C.muted}">${escapeHtml(footer)}</td></tr>
</table>
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
  return `<p style="margin:0 0 14px">${escapeHtml(text)}</p>`;
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
    bodyHtml: `<p style="margin:0 0 10px;font-size:18px;font-weight:600;line-height:1.35">${escapeHtml(input.title)}</p>${input.body ? paragraph(input.body) : ""}`,
    bodyText: [input.title, input.body].filter(Boolean).join("\n\n"),
    cta: input.url ? { label: "Open in Bananasplit", url: input.url } : undefined,
    footer: "Change which notifications email you on your profile.",
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
      `<p style="margin:0 0 14px">${escapeHtml(input.inviterName)} invited you to join <strong>${escapeHtml(input.orgName)}</strong> as ${escapeHtml(role)}.</p>` +
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
      `<p style="margin:0 0 14px">Your expense <strong>${escapeHtml(input.description)}</strong> ${escapeHtml(summary)}.</p>` +
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
        `<li style="margin:0 0 6px">${escapeHtml(p.description)} &mdash; ${escapeHtml(p.amountFormatted)} <span style="color:${C.muted}">(${escapeHtml(p.submitterName)})</span></li>`,
    )
    .join("");
  return layout({
    subject: `${n} expense${n === 1 ? "" : "s"} awaiting your review in ${input.orgName}`,
    eyebrow: input.orgName,
    bodyHtml:
      paragraph(`These expenses are waiting on an owner, admin or treasurer in ${input.orgName}:`) +
      `<ul style="margin:0 0 14px;padding-left:20px">${items}</ul>`,
    bodyText: `These expenses are waiting on an owner, admin or treasurer in ${input.orgName}:\n\n${input.pending
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

/** The link from "Forgot your password?". Says nothing about the account itself. */
export function passwordResetEmail(input: {
  name?: string | null;
  resetUrl: string;
  expiresMinutes: number;
}): RenderedEmail {
  const greeting = input.name ? `Hi ${input.name},` : "Hi,";
  const body = `Someone asked to reset the password for your ${PRODUCT} account. The link works once and expires in ${input.expiresMinutes} minutes.`;
  return layout({
    subject: `Reset your ${PRODUCT} password`,
    bodyHtml: paragraph(greeting) + paragraph(body),
    bodyText: `${greeting}

${body}`,
    cta: { label: "Set a new password", url: input.resetUrl },
    footer: "If you didn't ask for this, ignore this email: your password stays the same.",
  });
}

/** Sent after a password reset, so a change the owner didn't make doesn't go unnoticed. */
export function passwordChangedEmail(input: {
  name?: string | null;
  resetUrl: string;
}): RenderedEmail {
  const greeting = input.name ? `Hi ${input.name},` : "Hi,";
  const body = `The password for your ${PRODUCT} account was just changed, and every device that was signed in has been signed out.`;
  const notYou =
    "If you didn't do this, reset your password now and tell your organization's admins.";
  return layout({
    subject: `Your ${PRODUCT} password was changed`,
    bodyHtml: paragraph(greeting) + paragraph(body) + paragraph(notYou),
    bodyText: `${greeting}

${body}

${notYou}`,
    cta: { label: "Reset my password", url: input.resetUrl },
    footer: `You're receiving this because the password changed on your ${PRODUCT} account.`,
  });
}

/**
 * "Your free trial is almost up": to a space's owners TRIAL_NOTICE_DAYS
 * before its trial ends (the trial-reminder-email job). No card was taken,
 * so nothing is charged: the space moves to its free plan unless they pick one.
 */
export function trialEndingEmail(input: {
  name?: string | null;
  /** The organization's name; absent for a Personal space. */
  orgName?: string | null;
  trialPlan: string;
  freePlan: string;
  daysLeft: number;
  /** The owner picked `freePlan` during the trial (Team, Team Advanced), so it isn't free. */
  picked?: boolean;
  /** "Thursday, November 6". */
  endsOn: string;
  url: string;
}): RenderedEmail {
  const greeting = input.name ? `Hi ${input.name},` : "Hi,";
  const days = `${input.daysLeft} ${input.daysLeft === 1 ? "day" : "days"}`;
  const whose = input.orgName ? `${input.orgName}'s` : "Your";
  const intro = `${whose} free trial of ${input.trialPlan} ends in ${days}, on ${input.endsOn}.`;
  const after = input.picked
    ? `After that, ${input.orgName ?? "your space"} moves to ${input.freePlan}, the plan you picked. Nothing is deleted.`
    : input.orgName
      ? `After that, ${input.orgName} moves to ${input.freePlan}. Nothing is deleted, and you won't be charged: we never asked for a card. Pick Team or Team Advanced to keep finance, reports, the org chart and AI.`
      : `After that, you move to ${input.freePlan}. Nothing is deleted, and you won't be charged: we never asked for a card. Pick ${input.trialPlan} to keep themes, integrations and AI.`;
  return layout({
    subject: "Your free trial is almost up",
    eyebrow: input.orgName ?? undefined,
    bodyHtml: paragraph(greeting) + paragraph(intro) + paragraph(after),
    bodyText: `${greeting}

${intro}

${after}`,
    cta: { label: "See plans", url: input.url },
    footer: `You're receiving this because you own ${input.orgName ?? "a space"} on ${PRODUCT}.`,
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
