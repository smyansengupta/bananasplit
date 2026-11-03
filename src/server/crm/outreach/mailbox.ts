import "server-only";

import type { CrmMailbox } from "@/generated/prisma/client";
import { assertNoTx } from "@/server/db/context";
import { domainOf, platformFrom } from "@/server/email/config";
import { displayName } from "@/server/email/escape";
import { platformNoReplyAddress, resolveOrgMailRouting, type OrgMailRouting } from "@/server/email/mailer";
import { EmailConfigError, transportFor } from "@/server/email/transport";
import { getSecret } from "@/server/secrets";

/**
 * The ONE way CRM mail leaves Bananasplit (docs/features/crm.md, module 5,
 * "Whose mailbox"). sendFromMailbox picks the mailbox for a member and
 * sends; everything that emails a person (1:1 compose, sequences,
 * campaigns, bulk, booking confirmations) goes through it from a job, never
 * inside a transaction.
 *
 * Today a member has no connected mailbox, so mail goes out from the
 * organization's own verified Resend sender ("Ada at Harbor Robotics"
 * <hello@robotics.org>), or for one-to-one mail the platform sender on
 * the organization's behalf. Bulk mail never uses the platform sender: a
 * bad list must never hurt our sending reputation. When the email
 * connections project lands, memberMailbox() returns the member's Gmail or
 * Outlook and the same callers send from it unchanged.
 *
 * EMAIL_DELIVERY applies (sink and off never reach a provider).
 */

export type MailPurpose = "one-to-one" | "sequence" | "bulk";

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Where replies go: our reply+{token}@ address, or the member's own. */
  replyTo?: string;
  headers?: Record<string, string>;
}

export interface SentEmail {
  mailbox: CrmMailbox;
  providerId: string | null;
  from: string;
}

/** The sender check bulk email needs: the organization's own domain, verified (SPF and DKIM) in Resend. */
export interface SenderCheck {
  ok: boolean;
  /** "Harbor Robotics <hello@harborrobotics.org>" when there's one. */
  from: string | null;
  domain: string | null;
  /** What to fix, in words, when not ok. */
  problem: string | null;
}

export function senderCheckOf(routing: OrgMailRouting): SenderCheck {
  if (routing.mode === "org" && routing.sender?.domainVerifiedAt) {
    return {
      ok: true,
      from: routing.sender.fromAddress,
      domain: routing.sender.domain ?? domainOf(routing.sender.fromAddress),
      problem: null,
    };
  }
  return {
    ok: false,
    from: null,
    domain: null,
    problem:
      "Bulk email goes out only from your organization's own domain. Connect an email sender in Integrations and apps and verify its domain in Resend (that sets up SPF and DKIM).",
  };
}

/** Checks the organization's sender (service path; call outside a transaction). */
export async function checkSender(organizationId: string): Promise<SenderCheck> {
  return senderCheckOf(await resolveOrgMailRouting(organizationId));
}

/**
 * A member's own connected mailbox (Gmail, Outlook, IMAP). None yet: the
 * email connections project fills this in; until then every send uses the
 * organization's sender.
 */
async function memberMailbox(
  _organizationId: string,
  _userId: string,
): Promise<{ kind: CrmMailbox; send: (m: OutboundEmail, key: string, signal?: AbortSignal) => Promise<SentEmail> } | null> {
  return null;
}

/** Sends one CRM email as `sender` (their name, the organization's mailbox). */
export async function sendFromMailbox(input: {
  organizationId: string;
  /** The member it's from (their name shows; later, their own mailbox). */
  senderUserId: string | null;
  senderName: string | null;
  purpose: MailPurpose;
  message: OutboundEmail;
  /** Provider de-duplication (the CrmEmailMessage id). */
  idempotencyKey: string;
  signal?: AbortSignal;
}): Promise<SentEmail> {
  assertNoTx("crm email send");
  if (input.senderUserId && input.purpose !== "bulk") {
    const own = await memberMailbox(input.organizationId, input.senderUserId);
    if (own) return own.send(input.message, input.idempotencyKey, input.signal);
  }
  const routing = await resolveOrgMailRouting(input.organizationId);
  if (routing.mode === "none") throw new EmailConfigError("organization not found");
  const person = input.senderName?.trim();
  let from: string;
  let apiKey: string | null | undefined;
  if (routing.mode === "org" && routing.integrationId && routing.sender) {
    apiKey = await getSecret({ orgId: input.organizationId, integrationId: routing.integrationId, kind: "API_KEY" });
    const org = routing.sender.fromName ?? routing.orgName;
    from = `"${displayName(person ? `${person} at ${org}` : org)}" <${routing.sender.fromAddress}>`;
  } else {
    if (input.purpose === "bulk") {
      throw new EmailConfigError("bulk email needs the organization's own verified sender");
    }
    apiKey = process.env.RESEND_API_KEY;
    const label = person ? `${person} at ${routing.orgName} via Bananasplit` : `${routing.orgName} via Bananasplit`;
    from = `"${displayName(label)}" <${platformNoReplyAddress()}>`;
  }
  if (!apiKey && routing.mode === "org") throw new EmailConfigError("the organization's Resend key is missing");
  const transport = transportFor(apiKey);
  const result = await transport.send(
    {
      from,
      to: input.message.to,
      replyTo: input.message.replyTo,
      subject: input.message.subject,
      html: input.message.html,
      text: input.message.text,
      headers: input.message.headers,
    },
    { idempotencyKey: `crm:${input.idempotencyKey}`, signal: input.signal },
  );
  return { mailbox: "ORG_SENDER", providerId: result.id, from };
}

/** Where replies come back: CRM_INBOUND_DOMAIN (the Cloudflare Email Worker's domain), if set. */
export function inboundDomain(): string | null {
  const d = process.env.CRM_INBOUND_DOMAIN?.trim().toLowerCase();
  return d && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? d : null;
}

/** A member's BCC logging address, or null without an inbound domain. */
export function bccAddress(bccToken: string): string | null {
  const d = inboundDomain();
  return d ? `log+${bccToken}@${d}` : null;
}

/** The Reply-To that brings a reply back through /api/crm/inbound. */
export function replyAddress(trackingToken: string): string | null {
  const d = inboundDomain();
  return d ? `reply+${trackingToken}@${d}` : null;
}

/** Our own Message-ID for a CRM email. */
export function messageIdFor(messageId: string): string {
  const host = inboundDomain() ?? domainOf(platformFrom());
  return `crm-${messageId}@${host}`;
}
