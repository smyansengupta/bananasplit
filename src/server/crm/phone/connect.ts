import type { IntegrationProvider } from "@/generated/prisma/client";
import { requirePermission } from "@/lib/auth/permissions";
import { toE164 } from "@/lib/crm/phone";
import { writeOrgAuditLog } from "@/server/audit";
import { withOrgTx } from "@/server/db/context";
import { setSecret, testIntegration, type IntegrationTestResult, type SecretActor } from "@/server/secrets";

import { phoneWebhookUrls } from "./connection";
import {
  deepgramCheck,
  ProviderError,
  telnyxNumbers,
  twilioCreateApiKey,
  twilioCreateApp,
  twilioNumbers,
  type ProviderNumber,
} from "./providers";
import { isTelnyxPublicKey } from "./signatures";

/**
 * The Telnyx, Twilio and Deepgram cards on Integrations and apps: the
 * organization's own keys, stored as OrgSecrets through the secrets module
 * (owners and admins; audited; owners alerted), tested at once, and the
 * number calls and texts go out from. Network checks run with no
 * transaction open, as every integration does.
 *
 * - Telnyx: an API key (secret), the account's public key (checks webhook
 *   signatures; not secret), and the credential connection the softphone
 *   registers on (optional).
 * - Twilio: the Account SID and auth token (secret; it also checks webhook
 *   signatures). Saving makes the softphone's TwiML app and its signing
 *   API key in the account, once; the key's secret is the integration's
 *   second secret (kind REFRESH_TOKEN, the only other per-integration slot).
 * - Deepgram: a key.
 */

export type ConnectResult = { ok: true; message?: string } | { ok: false; error: string };

export interface PhoneActor extends SecretActor {
  userId: string;
}

function fail(error: string): ConnectResult {
  return { ok: false, error };
}

function from(result: IntegrationTestResult, message: string): ConnectResult {
  return result.ok ? { ok: true, message } : { ok: false, error: result.reason };
}

function providerReason(error: unknown, who: string): string {
  if (error instanceof ProviderError) {
    if (error.status === 401 || error.status === 403) return `${who} didn't accept that key.`;
    return `${who} said no: ${error.message.replace(/^.*?said no /, "")}`;
  }
  return `${who} couldn't be reached. Try again.`;
}

function numbersConfig(numbers: ProviderNumber[], current: unknown) {
  const list = numbers.slice(0, 50).map((n) => ({ number: n.number, label: n.label?.slice(0, 80) ?? null }));
  const kept = typeof current === "string" && list.some((n) => n.number === current) ? current : null;
  return { numbers: list, number: kept ?? (typeof current === "string" && current ? current : (list[0]?.number ?? null)) };
}

async function currentConfig(orgId: string, provider: IntegrationProvider): Promise<Record<string, unknown>> {
  const row = await withOrgTx(orgId, ({ db }) =>
    db.orgIntegration.findUnique({
      where: { organizationId_provider: { organizationId: orgId, provider } },
      select: { config: true },
    }),
  );
  return (row?.config ?? {}) as Record<string, unknown>;
}

// ---- Telnyx ---------------------------------------------------------------------------

const TELNYX_KEY = /^KEY[A-Za-z0-9_-]{20,200}$/;
const TELNYX_CONNECTION = /^\d{6,30}$/;

export async function saveTelnyx(
  orgId: string,
  actor: PhoneActor,
  input: { apiKey?: string; publicKey?: string; connectionId?: string },
): Promise<ConnectResult> {
  requirePermission(actor, "integrations.write");
  const apiKey = input.apiKey?.trim() ?? "";
  const publicKey = input.publicKey?.trim() ?? "";
  const connectionId = input.connectionId?.trim() ?? "";
  if (publicKey && !isTelnyxPublicKey(publicKey)) {
    return fail("That isn't a Telnyx public key. Copy it from Mission Control, Keys and credentials, Public key.");
  }
  if (connectionId && !TELNYX_CONNECTION.test(connectionId)) return fail("The connection ID is the number on its page in Telnyx.");
  const config: Record<string, unknown> = {
    ...(publicKey ? { publicKey } : {}),
    ...(input.connectionId !== undefined ? { connectionId: connectionId || null } : {}),
  };
  const current = await currentConfig(orgId, "TELNYX");
  if (connectionId && current.connectionId !== connectionId) config.credentialId = null;
  if (apiKey) {
    if (!TELNYX_KEY.test(apiKey)) return fail("That doesn't look like a Telnyx API key (KEY…).");
    let numbers: ProviderNumber[];
    try {
      numbers = await telnyxNumbers(apiKey, AbortSignal.timeout(10_000));
    } catch (error) {
      return fail(providerReason(error, "Telnyx"));
    }
    await setSecret({
      orgId,
      actor,
      provider: "TELNYX",
      kind: "API_KEY",
      value: apiKey,
      config: { ...config, ...numbersConfig(numbers, current.number) },
    });
  } else {
    if (Object.keys(config).length === 0) return fail("Paste the API key first.");
    const saved = await patchConfig(orgId, actor, "TELNYX", config);
    if (!saved) return fail("Paste the API key first.");
  }
  return from(
    await testIntegration({ orgId, actor, provider: "TELNYX", test: telnyxTest }),
    "Saved. Telnyx accepted the key.",
  );
}

async function telnyxTest({ secret, config, signal }: { secret: string | null; config: Record<string, unknown>; signal: AbortSignal }): Promise<IntegrationTestResult> {
  if (!secret) return { ok: false, reason: "Paste the API key first." };
  try {
    const numbers = await telnyxNumbers(secret, signal);
    if (!config.publicKey) {
      return { ok: false, reason: "Add the account's public key too, so Bananasplit can trust what Telnyx sends." };
    }
    return { ok: true, config: numbersConfig(numbers, config.number) };
  } catch (error) {
    return { ok: false, reason: providerReason(error, "Telnyx") };
  }
}

// ---- Twilio ---------------------------------------------------------------------------

const ACCOUNT_SID = /^AC[0-9a-f]{32}$/;
const AUTH_TOKEN = /^[0-9a-f]{32}$/;

export async function saveTwilio(
  orgId: string,
  actor: PhoneActor,
  input: { accountSid?: string; authToken?: string },
): Promise<ConnectResult> {
  requirePermission(actor, "integrations.write");
  const accountSid = input.accountSid?.trim() ?? "";
  const authToken = input.authToken?.trim() ?? "";
  if (!ACCOUNT_SID.test(accountSid)) return fail("The Account SID starts with AC and has 34 characters.");
  const current = await currentConfig(orgId, "TWILIO");
  if (!authToken) {
    if (current.accountSid !== accountSid) return fail("Paste the auth token for that account too.");
    return from(await testIntegration({ orgId, actor, provider: "TWILIO", test: twilioTest }), "Twilio works.");
  }
  if (!AUTH_TOKEN.test(authToken)) return fail("The auth token is 32 letters and digits from the Twilio console.");
  let numbers: ProviderNumber[];
  const sameAccount = current.accountSid === accountSid;
  let appSid = sameAccount && typeof current.twimlAppSid === "string" ? current.twimlAppSid : null;
  let apiKeySid = sameAccount && typeof current.apiKeySid === "string" ? current.apiKeySid : null;
  let keySecret: string | null = null;
  try {
    const signal = AbortSignal.timeout(15_000);
    numbers = await twilioNumbers(accountSid, authToken, signal);
    if (!appSid) appSid = await twilioCreateApp(accountSid, authToken, phoneWebhookUrls(orgId).twilioVoice, signal);
    if (!apiKeySid) {
      const key = await twilioCreateApiKey(accountSid, authToken, signal);
      apiKeySid = key.sid;
      keySecret = key.secret;
    }
  } catch (error) {
    return fail(providerReason(error, "Twilio"));
  }
  if (keySecret) {
    await setSecret({ orgId, actor, provider: "TWILIO", kind: "REFRESH_TOKEN", value: keySecret, config: { apiKeySid } });
  }
  await setSecret({
    orgId,
    actor,
    provider: "TWILIO",
    kind: "API_KEY",
    value: authToken,
    config: { accountSid, twimlAppSid: appSid, apiKeySid, ...numbersConfig(numbers, current.number) },
  });
  return from(
    await testIntegration({ orgId, actor, provider: "TWILIO", test: twilioTest }),
    "Saved. Twilio accepted it, and the softphone is ready.",
  );
}

async function twilioTest({ secret, config, signal }: { secret: string | null; config: Record<string, unknown>; signal: AbortSignal }): Promise<IntegrationTestResult> {
  const sid = typeof config.accountSid === "string" ? config.accountSid : "";
  if (!secret || !sid) return { ok: false, reason: "Paste the Account SID and auth token first." };
  try {
    return { ok: true, config: numbersConfig(await twilioNumbers(sid, secret, signal), config.number) };
  } catch (error) {
    return { ok: false, reason: providerReason(error, "Twilio") };
  }
}

// ---- Deepgram -------------------------------------------------------------------------

export async function saveDeepgram(orgId: string, actor: PhoneActor, input: { apiKey?: string }): Promise<ConnectResult> {
  requirePermission(actor, "integrations.write");
  const apiKey = input.apiKey?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{30,80}$/.test(apiKey)) return fail("That doesn't look like a Deepgram API key.");
  await setSecret({ orgId, actor, provider: "DEEPGRAM", kind: "API_KEY", value: apiKey });
  return from(
    await testIntegration({ orgId, actor, provider: "DEEPGRAM", test: deepgramTest }),
    "Saved. Deepgram accepted the key.",
  );
}

async function deepgramTest({ secret, signal }: { secret: string | null; signal: AbortSignal }): Promise<IntegrationTestResult> {
  if (!secret) return { ok: false, reason: "Paste the API key first." };
  try {
    await deepgramCheck(secret, signal);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: providerReason(error, "Deepgram") };
  }
}

/** The Test button on each card (src/server/integrations/service.ts testProvider). */
export async function testPhoneIntegration(
  orgId: string,
  actor: PhoneActor,
  provider: "TELNYX" | "TWILIO" | "DEEPGRAM",
): Promise<ConnectResult> {
  requirePermission(actor, "integrations.write");
  switch (provider) {
    case "TELNYX":
      return from(await testIntegration({ orgId, actor, provider, test: telnyxTest }), "Telnyx works. The number list is up to date.");
    case "TWILIO":
      return from(await testIntegration({ orgId, actor, provider, test: twilioTest }), "Twilio works. The number list is up to date.");
    case "DEEPGRAM":
      return from(await testIntegration({ orgId, actor, provider, test: deepgramTest }), "Deepgram works.");
  }
}

// ---- The number ------------------------------------------------------------------------

/** Picks (or types) the number calls and texts go out from. */
export async function setPhoneNumber(
  orgId: string,
  actor: PhoneActor,
  provider: "TELNYX" | "TWILIO",
  input: string,
): Promise<ConnectResult> {
  requirePermission(actor, "integrations.write");
  const raw = input.trim();
  const number = raw.startsWith("MG") && provider === "TWILIO" && /^MG[0-9a-f]{32}$/.test(raw) ? raw : toE164(raw);
  if (!number) return fail("Type the number with its country code, like +1 555 123 4567.");
  const saved = await patchConfig(orgId, actor, provider, { number });
  return saved ? { ok: true, message: "Calls and texts go out from this number." } : fail("Connect it first.");
}

/** Merges non-secret config (app_user: owners' and admins' rows only), audited. */
async function patchConfig(
  orgId: string,
  actor: PhoneActor,
  provider: IntegrationProvider,
  patch: Record<string, unknown>,
): Promise<boolean> {
  return withOrgTx(orgId, async ({ db }) => {
    const row = await db.orgIntegration.findUnique({
      where: { organizationId_provider: { organizationId: orgId, provider } },
      select: { id: true, config: true },
    });
    if (!row) return false;
    await db.orgIntegration.update({
      where: { id: row.id },
      data: { config: { ...((row.config ?? {}) as Record<string, unknown>), ...patch } as object },
    });
    await writeOrgAuditLog(db, {
      organizationId: orgId,
      action: "integration.config_changed",
      targetType: "OrgIntegration",
      targetId: row.id,
      diff: { provider, keys: Object.keys(patch) },
    });
    return true;
  });
}
