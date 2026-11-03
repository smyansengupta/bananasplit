import type { IntegrationProvider } from "@/generated/prisma/client";
import { appUrl } from "@/lib/app-url";
import { readPhoneSettings, type PhoneProvider, type PhoneSettings } from "@/lib/crm/phone";
import { assertNoTx, withSystemOrgTx, type TxClient } from "@/server/db/context";
import { getSecret } from "@/server/secrets";

/**
 * Which phone provider an organization has connected, and the credentials
 * to use it (docs/features/crm.md, Phase 5). Members can't read
 * OrgIntegration (owners and admins manage keys), so the CRM reads the
 * non-secret status here on the service path, for a caller that has
 * already checked membership (every CRM page and action has). Secrets are
 * decrypted only by loadPhoneConnection, outside any transaction, for the
 * one request or job that calls the provider.
 */

export const PHONE_INTEGRATIONS: Record<PhoneProvider, IntegrationProvider> = {
  telnyx: "TELNYX",
  twilio: "TWILIO",
};

export interface ProviderStatus {
  connected: boolean;
  /** The number calls and texts go out from (E.164). */
  number: string | null;
  /** The softphone can run (Telnyx: a connection id; Twilio: the app and key were made). */
  softphone: boolean;
}

export interface PhoneStatus {
  telnyx: ProviderStatus;
  twilio: ProviderStatus;
  deepgram: { connected: boolean };
  /** The provider in use (the chosen one, else the first connected), or null. */
  active: PhoneProvider | null;
  number: string | null;
  settings: PhoneSettings;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Status and settings, read in the caller's own transaction on the service path. */
export async function readPhoneStatus(db: TxClient, organizationId: string): Promise<PhoneStatus> {
  const rows = await db.orgIntegration.findMany({
    where: { organizationId, provider: { in: ["TELNYX", "TWILIO", "DEEPGRAM"] } },
    select: { provider: true, status: true, config: true, secretFingerprint: true },
  });
  const crm = await db.crmSettings.findUnique({ where: { organizationId }, select: { phone: true } });
  const settings = readPhoneSettings(crm?.phone);
  const of = (p: IntegrationProvider) => rows.find((r) => r.provider === p);
  const status = (p: IntegrationProvider): ProviderStatus => {
    const row = of(p);
    const config = (row?.config ?? {}) as Record<string, unknown>;
    const connected = Boolean(row && row.status === "CONNECTED" && row.secretFingerprint);
    return {
      connected,
      number: str(config.number),
      softphone:
        connected &&
        (p === "TELNYX" ? Boolean(str(config.connectionId)) : Boolean(str(config.twimlAppSid) && str(config.apiKeySid))),
    };
  };
  const telnyx = status("TELNYX");
  const twilio = status("TWILIO");
  const deepgramRow = of("DEEPGRAM");
  const pick: PhoneProvider | null =
    settings.provider && (settings.provider === "telnyx" ? telnyx : twilio).connected
      ? settings.provider
      : telnyx.connected
        ? "telnyx"
        : twilio.connected
          ? "twilio"
          : null;
  return {
    telnyx,
    twilio,
    deepgram: { connected: Boolean(deepgramRow && deepgramRow.status === "CONNECTED" && deepgramRow.secretFingerprint) },
    active: pick,
    number: pick ? (pick === "telnyx" ? telnyx.number : twilio.number) : null,
    settings,
  };
}

/** The same, opening its own short service transaction (outside any other). */
export async function phoneStatus(organizationId: string): Promise<PhoneStatus> {
  return withSystemOrgTx(organizationId, ({ db }) => readPhoneStatus(db, organizationId));
}

export type PhoneConnection =
  | {
      provider: "telnyx";
      number: string | null;
      apiKey: string;
      publicKey: string | null;
      connectionId: string | null;
      credentialId: string | null;
      integrationId: string;
    }
  | {
      provider: "twilio";
      number: string | null;
      accountSid: string;
      authToken: string;
      apiKeySid: string | null;
      apiKeySecret: string | null;
      appSid: string | null;
      integrationId: string;
    };

async function configOf(organizationId: string, provider: IntegrationProvider) {
  return withSystemOrgTx(organizationId, async ({ db }) =>
    db.orgIntegration.findUnique({
      where: { organizationId_provider: { organizationId, provider } },
      select: { id: true, status: true, config: true },
    }),
  );
}

/**
 * The credentials of one provider (the active one when not named), or
 * null when it isn't connected. Outside any transaction.
 */
export async function loadPhoneConnection(
  organizationId: string,
  provider?: PhoneProvider | null,
  options: { evenIfNotConnected?: boolean } = {},
): Promise<PhoneConnection | null> {
  assertNoTx("loadPhoneConnection");
  const which = provider ?? (await phoneStatus(organizationId)).active;
  if (!which) return null;
  const row = await configOf(organizationId, PHONE_INTEGRATIONS[which]);
  if (!row || (!options.evenIfNotConnected && row.status !== "CONNECTED")) return null;
  const config = (row.config ?? {}) as Record<string, unknown>;
  const secret = await getSecret({ orgId: organizationId, provider: PHONE_INTEGRATIONS[which], kind: "API_KEY" });
  if (!secret) return null;
  if (which === "telnyx") {
    return {
      provider: "telnyx",
      number: str(config.number),
      apiKey: secret,
      publicKey: str(config.publicKey),
      connectionId: str(config.connectionId),
      credentialId: str(config.credentialId),
      integrationId: row.id,
    };
  }
  const accountSid = str(config.accountSid);
  if (!accountSid) return null;
  // The softphone's signing key is the integration's second secret.
  const apiKeySecret = await getSecret({ orgId: organizationId, provider: "TWILIO", kind: "REFRESH_TOKEN" });
  return {
    provider: "twilio",
    number: str(config.number),
    accountSid,
    authToken: secret,
    apiKeySid: str(config.apiKeySid),
    apiKeySecret,
    appSid: str(config.twimlAppSid),
    integrationId: row.id,
  };
}

/** What a webhook route needs to check a signature: the Telnyx public key, or the Twilio auth token. */
export async function webhookSecret(organizationId: string, provider: PhoneProvider): Promise<string | null> {
  assertNoTx("webhookSecret");
  const row = await configOf(organizationId, PHONE_INTEGRATIONS[provider]);
  if (!row) return null;
  if (provider === "telnyx") return str(((row.config ?? {}) as Record<string, unknown>).publicKey);
  return getSecret({ orgId: organizationId, provider: "TWILIO", kind: "API_KEY" });
}

/** The Deepgram key, or null. Outside any transaction. */
export async function deepgramKey(organizationId: string): Promise<string | null> {
  assertNoTx("deepgramKey");
  const row = await configOf(organizationId, "DEEPGRAM");
  if (!row || row.status !== "CONNECTED") return null;
  return getSecret({ orgId: organizationId, provider: "DEEPGRAM", kind: "API_KEY" });
}

/** The addresses an organization pastes into its provider's console. */
export function phoneWebhookUrls(organizationId: string): {
  telnyx: string;
  twilioVoice: string;
  twilioStatus: string;
  twilioSms: string;
} {
  const base = `/api/crm/phone`;
  return {
    telnyx: appUrl(`${base}/telnyx/${organizationId}`),
    twilioVoice: appUrl(`${base}/twilio/${organizationId}/voice`),
    twilioStatus: appUrl(`${base}/twilio/${organizationId}/status`),
    twilioSms: appUrl(`${base}/twilio/${organizationId}/sms`),
  };
}

/** Keeps a value the provider gave us in the integration's config (service path, no audit: not a person's change). */
export async function rememberConfig(
  organizationId: string,
  provider: IntegrationProvider,
  patch: Record<string, unknown>,
): Promise<void> {
  await withSystemOrgTx(organizationId, async ({ db }) => {
    const row = await db.orgIntegration.findUnique({
      where: { organizationId_provider: { organizationId, provider } },
      select: { id: true, config: true },
    });
    if (!row) return;
    await db.orgIntegration.update({
      where: { id: row.id },
      data: { config: { ...((row.config ?? {}) as Record<string, unknown>), ...patch } as object },
    });
  });
}
