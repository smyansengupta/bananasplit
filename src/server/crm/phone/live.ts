import { appUrl } from "@/lib/app-url";
import { missingKeyMessage } from "@/lib/crm/org-keys";
import { maskNumber } from "@/lib/crm/phone";
import { withSystemOrgTx } from "@/server/db/context";

import { CrmError } from "../access";
import { signAudioLink } from "./audio";
import { loadPhoneConnection, PHONE_INTEGRATIONS, phoneStatus, rememberConfig } from "./connection";
import {
  ProviderError,
  telnyxCallAction,
  telnyxCreateCredential,
  telnyxLoginToken,
  twilioAccessToken,
  twilioChildCall,
  twilioUpdateCall,
} from "./providers";

/**
 * What a live call needs from the provider, called by the member's actions
 * after their CRM check has committed (no transaction is ever open here):
 * the softphone's short-lived token, the recording notice, and the
 * voicemail drop.
 */

export type SoftphoneToken =
  | { provider: "telnyx"; token: string; number: string }
  | { provider: "twilio"; token: string; number: string };

/** A token for this member's browser (Telnyx: a login token on the org's credential; Twilio: a signed access token). */
export async function softphoneToken(organizationId: string, userId: string): Promise<SoftphoneToken> {
  const conn = await loadPhoneConnection(organizationId);
  if (!conn) throw new CrmError(missingKeyMessage("Telnyx or Twilio"));
  if (!conn.number) throw new CrmError("Pick the number calls go out from on Integrations and apps.");
  try {
    if (conn.provider === "telnyx") {
      if (!conn.connectionId) throw new CrmError("Add the credential connection on the Telnyx card to call from the browser.");
      let credentialId = conn.credentialId;
      if (!credentialId) {
        credentialId = await telnyxCreateCredential(conn.apiKey, conn.connectionId);
        await rememberConfig(organizationId, PHONE_INTEGRATIONS.telnyx, { credentialId });
      }
      return { provider: "telnyx", token: await telnyxLoginToken(conn.apiKey, credentialId), number: conn.number };
    }
    if (!conn.apiKeySid || !conn.apiKeySecret || !conn.appSid) {
      throw new CrmError("Save the Twilio card again to finish setting up calls from the browser.");
    }
    return {
      provider: "twilio",
      token: twilioAccessToken({
        accountSid: conn.accountSid,
        apiKeySid: conn.apiKeySid,
        apiKeySecret: conn.apiKeySecret,
        appSid: conn.appSid,
        identity: userId,
      }),
      number: conn.number,
    };
  } catch (error) {
    if (error instanceof ProviderError) throw new CrmError("The phone provider didn't answer. Try again in a moment.");
    throw error;
  }
}

/** client_state as Telnyx carries it: base64 of "{what}:{callId}". */
export function clientState(what: "call" | "notice" | "vm", callId: string): string {
  return Buffer.from(`${what}:${callId}`).toString("base64");
}

export function readClientState(raw: unknown): { what: string; callId: string } | null {
  if (typeof raw !== "string" || raw.length > 200) return null;
  const s = Buffer.from(raw, "base64").toString("utf8");
  const m = /^(call|notice|vm):([A-Za-z0-9_-]{1,100})$/.exec(s);
  return m ? { what: m[1]!, callId: m[2]! } : null;
}

async function liveCall(organizationId: string, callId: string, userId: string) {
  const call = await withSystemOrgTx(organizationId, ({ db }) =>
    db.crmCall.findFirst({
      where: { id: callId, organizationId },
      select: { id: true, userId: true, provider: true, providerCallId: true, status: true, toNumber: true },
    }),
  );
  if (!call || call.userId !== userId) throw new CrmError("That call isn't yours.");
  if (!call.providerCallId || !["RINGING", "IN_PROGRESS", "QUEUED"].includes(call.status)) {
    throw new CrmError("The call isn't connected yet.");
  }
  return call;
}

/**
 * Plays the all-party recording notice; recording starts when the
 * provider says it finished playing (the webhook), never before. Telnyx
 * only: with Twilio the member chooses Record before dialling and the
 * notice plays to the person as they answer.
 */
export async function startRecording(organizationId: string, callId: string, userId: string): Promise<void> {
  const status = await phoneStatus(organizationId);
  if (status.settings.recording === "never") throw new CrmError("Your organization doesn't record calls.");
  const call = await liveCall(organizationId, callId, userId);
  if (call.provider !== "telnyx") throw new CrmError("With Twilio, turn on Record before you call.");
  const conn = await loadPhoneConnection(organizationId, "telnyx");
  if (!conn || conn.provider !== "telnyx") throw new CrmError("Telnyx isn't connected any more.");
  try {
    await telnyxCallAction(conn.apiKey, call.providerCallId!, "speak", {
      payload: status.settings.notice,
      voice: "female",
      language: "en-US",
      client_state: clientState("notice", call.id),
    });
  } catch (error) {
    console.warn(`[crm:call] notice on a call to ${maskNumber(call.toNumber)} failed`);
    throw error instanceof ProviderError ? new CrmError("The notice didn't play, so recording didn't start.") : error;
  }
}

/** Starts recording once the notice has played (from the Telnyx webhook). */
export async function recordAfterNotice(organizationId: string, callControlId: string): Promise<void> {
  const conn = await loadPhoneConnection(organizationId, "telnyx");
  if (!conn || conn.provider !== "telnyx") return;
  await telnyxCallAction(conn.apiKey, callControlId, "record_start", { format: "mp3", channels: "dual", play_beep: true });
}

/** The address the provider fetches the voicemail from (signed, ten minutes). */
export function voicemailUrl(organizationId: string, key: string): string {
  const params = new URLSearchParams({ key, t: signAudioLink(organizationId, key) });
  return appUrl(`/api/crm/phone/voicemail/${organizationId}?${params}`);
}

/** Plays the organization's recorded voicemail into the call, then hangs up. */
export async function dropVoicemail(organizationId: string, callId: string, userId: string): Promise<void> {
  const status = await phoneStatus(organizationId);
  const key = status.settings.voicemailKey;
  if (!key) throw new CrmError("Record the voicemail to leave in CRM settings, Phone, first.");
  const call = await liveCall(organizationId, callId, userId);
  const url = voicemailUrl(organizationId, key);
  const conn = await loadPhoneConnection(organizationId, call.provider === "twilio" ? "twilio" : "telnyx");
  if (!conn) throw new CrmError("The phone provider isn't connected any more.");
  try {
    if (conn.provider === "telnyx") {
      await telnyxCallAction(conn.apiKey, call.providerCallId!, "playback_start", {
        audio_url: url,
        client_state: clientState("vm", call.id),
      });
    } else {
      const child = await twilioChildCall(conn.accountSid, conn.authToken, call.providerCallId!);
      if (!child) throw new CrmError("The person's side of the call isn't connected.");
      const safe = url.replace(/&/g, "&amp;");
      await twilioUpdateCall(conn.accountSid, conn.authToken, child, `<Response><Play>${safe}</Play><Hangup/></Response>`);
    }
  } catch (error) {
    if (error instanceof ProviderError) throw new CrmError("The voicemail didn't play. Leave one yourself.");
    throw error;
  }
  await withSystemOrgTx(organizationId, ({ db }) =>
    db.crmCall.updateMany({ where: { id: call.id, organizationId }, data: { outcome: "voicemail" } }),
  );
}

/** Hangs up after the voicemail (from the Telnyx webhook). */
export async function hangUp(organizationId: string, callControlId: string): Promise<void> {
  const conn = await loadPhoneConnection(organizationId, "telnyx");
  if (!conn || conn.provider !== "telnyx") return;
  await telnyxCallAction(conn.apiKey, callControlId, "hangup", {});
}
