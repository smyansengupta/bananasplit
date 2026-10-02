import { z } from "zod";

import { IntegrationProvider, IntegrationStatus } from "@/generated/prisma/client";
import { withSystemOrgTx } from "@/server/db/context";
import { getSecret } from "@/server/secrets";

import { addressOf, platformFrom } from "./config";
import { displayName } from "./escape";
import type { RenderedEmail } from "./templates";
import { transportFor, type SendOptions, type SendResult } from "./transport";

/**
 * Senders ('Email sender' decision).
 *
 * getPlatformMailer(): the platform sender (env RESEND_API_KEY + EMAIL_FROM
 *   on the verified platform domain), for account mail (verification) and
 *   invitations when the org has no sender of its own.
 *
 * getOrgMailer(orgId): the org's notification sender, routed as:
 *   1. the org's own Resend sender, when its EMAIL_RESEND integration is
 *      CONNECTED on a verified domain (fromAddress + domainVerifiedAt in
 *      OrgIntegration.config, the API key an OrgSecret);
 *   2. otherwise the platform sender "on behalf of" the org, while
 *      OrgSettings.platformMailFallback is true (backfilled true for orgs
 *      that existed at the Phase 1 migration, i.e. CBC);
 *   3. otherwise null: in-app notifications only (Settings shows a banner).
 *
 * EMAIL_DELIVERY and previews apply to both (sink/off never reach Resend).
 * Mailers are used OUTSIDE transactions: send() is network I/O.
 */

export type MailerKind = "platform" | "org" | "platform-fallback";

export interface Mailer {
  kind: MailerKind;
  /** The From header, "Name <address>". */
  from: string;
  replyTo?: string;
  /** Human description for the settings page / test email. */
  label: string;
  send(message: RenderedEmail & { to: string }, options?: SendOptions): Promise<SendResult>;
}

const PLATFORM_NAME = "Bananasplit";

/** The non-secret part of an org's Resend sender (OrgIntegration.config). */
export const resendSenderConfig = z.object({
  fromName: z.string().trim().min(1).max(80).optional(),
  fromAddress: z.email().max(254),
  replyTo: z.email().max(254).optional(),
  domain: z.string().max(253).optional(),
  /** Set by the domain check when Resend reports the domain verified. */
  domainVerifiedAt: z.string().optional(),
});

export type ResendSenderConfig = z.infer<typeof resendSenderConfig>;

function makeMailer(
  kind: MailerKind,
  from: string,
  apiKey: string | null | undefined,
  label: string,
  replyTo?: string,
): Mailer {
  return {
    kind,
    from,
    replyTo,
    label,
    async send(message, options) {
      const transport = transportFor(apiKey);
      return transport.send(
        {
          from,
          to: message.to,
          replyTo,
          subject: message.subject,
          html: message.html,
          text: message.text,
        },
        options,
      );
    },
  };
}

export function getPlatformMailer(): Mailer {
  return makeMailer("platform", platformFrom(), process.env.RESEND_API_KEY, "the platform sender");
}

export interface OrgMailRouting {
  mode: "org" | "platform-fallback" | "none";
  orgName: string;
  /** OrgSettings.platformMailFallback. */
  platformMailFallback: boolean;
  /** For mode "org": the integration whose secret holds the key. */
  integrationId?: string;
  sender?: ResendSenderConfig;
}

/** How the org's mail is routed right now (also for the Settings banner). */
export async function resolveOrgMailRouting(orgId: string): Promise<OrgMailRouting> {
  return withSystemOrgTx(orgId, async ({ db }) => {
    const org = await db.organization.findUnique({
      where: { id: orgId },
      select: {
        name: true,
        settings: { select: { platformMailFallback: true } },
        integrations: {
          where: { provider: IntegrationProvider.EMAIL_RESEND },
          select: { id: true, status: true, config: true },
        },
      },
    });
    if (!org) return { mode: "none", orgName: "", platformMailFallback: false };
    const platformMailFallback = org.settings?.platformMailFallback ?? false;
    const integration = org.integrations[0];
    if (integration && integration.status === IntegrationStatus.CONNECTED) {
      const parsed = resendSenderConfig.safeParse(integration.config);
      if (parsed.success && parsed.data.domainVerifiedAt) {
        return {
          mode: "org",
          orgName: org.name,
          platformMailFallback,
          integrationId: integration.id,
          sender: parsed.data,
        };
      }
    }
    return {
      mode: platformMailFallback ? "platform-fallback" : "none",
      orgName: org.name,
      platformMailFallback,
    };
  });
}

/** The platform sender, labelled "<Org> via Bananasplit". */
export function platformFallbackMailer(orgName: string): Mailer {
  const name = displayName(`${orgName} via ${PLATFORM_NAME}`);
  const from = `"${name}" <${addressOf(platformFrom())}>`;
  return makeMailer(
    "platform-fallback",
    from,
    process.env.RESEND_API_KEY,
    `the platform sender on behalf of ${orgName}`,
  );
}

/**
 * The org's sender, or null when the org gets in-app notifications only.
 * Reads the org's Resend key through the secrets accessor (service path).
 */
export async function getOrgMailer(orgId: string): Promise<Mailer | null> {
  const routing = await resolveOrgMailRouting(orgId);
  if (routing.mode === "org" && routing.integrationId && routing.sender) {
    const apiKey = await getSecret({
      orgId,
      integrationId: routing.integrationId,
      kind: "API_KEY",
    });
    if (apiKey) {
      const sender = routing.sender;
      const name = displayName(sender.fromName ?? routing.orgName);
      return makeMailer(
        "org",
        `"${name}" <${sender.fromAddress}>`,
        apiKey,
        `${routing.orgName}'s own sender (${sender.fromAddress})`,
        sender.replyTo,
      );
    }
  }
  // No usable org sender (or its key is gone): the platform fallback, if the
  // org has it, else in-app only.
  return routing.platformMailFallback ? platformFallbackMailer(routing.orgName) : null;
}
