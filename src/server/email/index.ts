/**
 * Email: senders, templates and the outbox kinds.
 *
 * - Senders: getOrgMailer(orgId) for org notification mail, getPlatformMailer()
 *   for account and invitation mail (./mailer.ts).
 * - Every send from app code goes through the outbox: notifyUser
 *   (src/server/notifications.ts) enqueues notify-email; invitations,
 *   reimbursement status mail and templated org mail enqueue invite-email,
 *   reimbursement-email and email jobs (src/server/jobs/registry.ts). The
 *   job sends after the enqueuing transaction commits, outside any
 *   transaction.
 * - With no Resend key (or EMAIL_DELIVERY=sink, or on previews) mail is
 *   written to the console and .data/mail/ instead of being sent.
 * - Templates HTML-escape every value and use absolute NEXT_PUBLIC_APP_URL
 *   links (./templates.ts).
 */
export {
  emailConfigProblems,
  emailDelivery,
  fromMatchesAppDomain,
  platformFrom,
  type EmailDelivery,
} from "./config";
export { escapeHtml, safeHref, subjectLine } from "./escape";
export {
  getOrgMailer,
  getPlatformMailer,
  platformFallbackMailer,
  resendSenderConfig,
  resolveOrgMailRouting,
  type Mailer,
  type OrgMailRouting,
  type ResendSenderConfig,
} from "./mailer";
export * as emailTemplates from "./templates";
export type { RenderedEmail } from "./templates";
export {
  EmailConfigError,
  EmailSendError,
  offTransport,
  resendTransport,
  sinkTransport,
  transportFor,
  type EmailTransport,
  type OutgoingEmail,
  type SendResult,
} from "./transport";
export { consumeVerificationToken, enqueueVerificationEmail } from "./verification";
