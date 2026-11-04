import { createHmac, randomBytes } from "node:crypto";

import { assertNoTx } from "@/server/db/context";

/**
 * The HTTP calls to Telnyx, Twilio and Deepgram, on the organization's own
 * keys (docs/features/crm.md: "calls and texts on their Telnyx or Twilio
 * key", "transcription only with the org's own Deepgram key"). Every call
 * goes through `phoneHttp.fetch`, the test seam, so no test reaches a
 * provider. Never inside a transaction; errors carry the provider's status
 * and a short reason, never a key or a full phone number.
 */

/** Test seam: replace in unit tests. */
export const phoneHttp = {
  fetch: (url: string, init: RequestInit): Promise<Response> => fetch(url, { redirect: "error", ...init }),
};

export class ProviderError extends Error {
  readonly status: number;
  /** 4xx other than 429: retrying won't help. */
  readonly permanent: boolean;
  constructor(provider: string, status: number, detail: string) {
    super(`${provider} said no (${status})${detail ? `: ${detail}` : ""}`);
    this.name = "ProviderError";
    this.status = status;
    this.permanent = status >= 400 && status < 500 && status !== 429;
  }
}

/** The first error message in a provider's JSON body, short, with digits runs masked. */
async function reason(res: Response): Promise<string> {
  const text = (await res.text().catch(() => "")).slice(0, 2000);
  let msg = text;
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const errors = j.errors as { detail?: string; title?: string }[] | undefined;
    msg =
      errors?.[0]?.detail ??
      errors?.[0]?.title ??
      (typeof j.message === "string" ? j.message : "") ??
      (typeof j.err_msg === "string" ? j.err_msg : "");
  } catch {
    /* not JSON */
  }
  return String(msg ?? "")
    .replace(/\+?\d{6,}/g, "•••")
    .slice(0, 160);
}

async function call(
  provider: string,
  url: string,
  init: RequestInit & { signal?: AbortSignal },
): Promise<Response> {
  assertNoTx(`${provider} request`);
  const res = await phoneHttp.fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(15_000) });
  if (!res.ok) throw new ProviderError(provider, res.status, await reason(res));
  return res;
}

// ---- Telnyx ---------------------------------------------------------------------------

const TELNYX = "https://api.telnyx.com/v2";

function telnyxHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" };
}

export interface ProviderNumber {
  number: string;
  label: string | null;
}

/** The numbers on the account: the test and the number picker. */
export async function telnyxNumbers(apiKey: string, signal?: AbortSignal): Promise<ProviderNumber[]> {
  const res = await call("Telnyx", `${TELNYX}/phone_numbers?page[size]=100`, {
    headers: telnyxHeaders(apiKey),
    signal,
  });
  const j = (await res.json()) as { data?: { phone_number?: string; connection_name?: string | null }[] };
  return (j.data ?? [])
    .filter((n) => typeof n.phone_number === "string")
    .map((n) => ({ number: n.phone_number!, label: n.connection_name ?? null }));
}

/** A telephony credential on the org's credential connection (made once, for the softphone). */
export async function telnyxCreateCredential(
  apiKey: string,
  connectionId: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await call("Telnyx", `${TELNYX}/telephony_credentials`, {
    method: "POST",
    headers: telnyxHeaders(apiKey),
    body: JSON.stringify({ connection_id: connectionId, name: "Bananasplit softphone" }),
    signal,
  });
  const j = (await res.json()) as { data?: { id?: string } };
  if (!j.data?.id) throw new ProviderError("Telnyx", 502, "no credential id");
  return j.data.id;
}

/** A short-lived login token (a JWT) for the browser SDK. */
export async function telnyxLoginToken(apiKey: string, credentialId: string, signal?: AbortSignal): Promise<string> {
  const res = await call("Telnyx", `${TELNYX}/telephony_credentials/${encodeURIComponent(credentialId)}/token`, {
    method: "POST",
    headers: telnyxHeaders(apiKey),
    signal,
  });
  const token = (await res.text()).trim();
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) throw new ProviderError("Telnyx", 502, "no token");
  return token;
}

/** A Call Control command on a live call (speak, record_start, playback_start, hangup...). */
export async function telnyxCallAction(
  apiKey: string,
  callControlId: string,
  action: "speak" | "record_start" | "record_stop" | "playback_start" | "hangup",
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<void> {
  await call("Telnyx", `${TELNYX}/calls/${encodeURIComponent(callControlId)}/actions/${action}`, {
    method: "POST",
    headers: telnyxHeaders(apiKey),
    body: JSON.stringify({ command_id: randomBytes(8).toString("hex"), ...body }),
    signal,
  });
}

/** A fresh download link for a call recording (Telnyx's links expire, so ask when fetching). */
export async function telnyxRecordingUrl(apiKey: string, recordingId: string, signal?: AbortSignal): Promise<string> {
  const res = await call("Telnyx", `${TELNYX}/recordings/${encodeURIComponent(recordingId)}`, {
    headers: telnyxHeaders(apiKey),
    signal,
  });
  const j = (await res.json()) as { data?: { download_urls?: { mp3?: string; wav?: string } } };
  const url = j.data?.download_urls?.mp3 ?? j.data?.download_urls?.wav;
  if (!url) throw new ProviderError("Telnyx", 404, "no recording link");
  return url;
}

export function twilioRecordingUrl(accountSid: string, recordingSid: string): string {
  return `${TWILIO}/Accounts/${encodeURIComponent(accountSid)}/Recordings/${encodeURIComponent(recordingSid)}.mp3`;
}

/** The callee's leg of a call the softphone placed (the voicemail drop plays there). */
export async function twilioChildCall(
  accountSid: string,
  authToken: string,
  parentSid: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const res = await call(
    "Twilio",
    `${TWILIO}/Accounts/${encodeURIComponent(accountSid)}/Calls.json?ParentCallSid=${encodeURIComponent(parentSid)}&PageSize=5`,
    { headers: { Authorization: twilioAuth(accountSid, authToken) }, signal },
  );
  const j = (await res.json()) as { calls?: { sid?: string; status?: string }[] };
  return j.calls?.find((c) => c.status === "in-progress")?.sid ?? j.calls?.[0]?.sid ?? null;
}

export async function telnyxSendText(
  apiKey: string,
  input: { from: string; to: string; body: string; webhookUrl?: string },
  signal?: AbortSignal,
): Promise<string | null> {
  const res = await call("Telnyx", `${TELNYX}/messages`, {
    method: "POST",
    headers: telnyxHeaders(apiKey),
    body: JSON.stringify({
      from: input.from,
      to: input.to,
      text: input.body,
      ...(input.webhookUrl ? { webhook_url: input.webhookUrl } : {}),
    }),
    signal,
  });
  const j = (await res.json().catch(() => ({}))) as { data?: { id?: string } };
  return j.data?.id ?? null;
}

// ---- Twilio ---------------------------------------------------------------------------

const TWILIO = "https://api.twilio.com/2010-04-01";

function twilioAuth(accountSid: string, authToken: string): string {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
}

function form(fields: Record<string, string | undefined>): URLSearchParams {
  const f = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) f.set(k, v);
  return f;
}

export async function twilioNumbers(
  accountSid: string,
  authToken: string,
  signal?: AbortSignal,
): Promise<ProviderNumber[]> {
  const res = await call(
    "Twilio",
    `${TWILIO}/Accounts/${encodeURIComponent(accountSid)}/IncomingPhoneNumbers.json?PageSize=100`,
    { headers: { Authorization: twilioAuth(accountSid, authToken) }, signal },
  );
  const j = (await res.json()) as { incoming_phone_numbers?: { phone_number?: string; friendly_name?: string }[] };
  return (j.incoming_phone_numbers ?? [])
    .filter((n) => typeof n.phone_number === "string")
    .map((n) => ({ number: n.phone_number!, label: n.friendly_name ?? null }));
}

/** The TwiML app the softphone dials through: its voice URL is our webhook. */
export async function twilioCreateApp(
  accountSid: string,
  authToken: string,
  voiceUrl: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await call("Twilio", `${TWILIO}/Accounts/${encodeURIComponent(accountSid)}/Applications.json`, {
    method: "POST",
    headers: { Authorization: twilioAuth(accountSid, authToken), "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ FriendlyName: "Bananasplit softphone", VoiceUrl: voiceUrl, VoiceMethod: "POST" }),
    signal,
  });
  const j = (await res.json()) as { sid?: string };
  if (!j.sid) throw new ProviderError("Twilio", 502, "no application sid");
  return j.sid;
}

/** An API key that signs the softphone's access tokens (Twilio needs one; the auth token can't). */
export async function twilioCreateApiKey(
  accountSid: string,
  authToken: string,
  signal?: AbortSignal,
): Promise<{ sid: string; secret: string }> {
  const res = await call("Twilio", `${TWILIO}/Accounts/${encodeURIComponent(accountSid)}/Keys.json`, {
    method: "POST",
    headers: { Authorization: twilioAuth(accountSid, authToken), "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ FriendlyName: "Bananasplit softphone" }),
    signal,
  });
  const j = (await res.json()) as { sid?: string; secret?: string };
  if (!j.sid || !j.secret) throw new ProviderError("Twilio", 502, "no key");
  return { sid: j.sid, secret: j.secret };
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * A Twilio Voice access token (HS256 under the API key's secret) that lets
 * this member's browser place outgoing calls through the TwiML app, for an
 * hour. Signed here; nothing is sent to Twilio.
 */
export function twilioAccessToken(input: {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  appSid: string;
  identity: string;
  ttlSec?: number;
  now?: number;
}): string {
  const now = Math.floor((input.now ?? Date.now()) / 1000);
  const header = { typ: "JWT", alg: "HS256", cty: "twilio-fpa;v=1" };
  const payload = {
    jti: `${input.apiKeySid}-${now}`,
    iss: input.apiKeySid,
    sub: input.accountSid,
    iat: now,
    nbf: now,
    exp: now + (input.ttlSec ?? 3600),
    grants: {
      identity: input.identity,
      voice: { incoming: { allow: false }, outgoing: { application_sid: input.appSid } },
    },
  };
  const body = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = createHmac("sha256", input.apiKeySecret).update(body).digest();
  return `${body}.${b64url(sig)}`;
}

export async function twilioSendText(
  accountSid: string,
  authToken: string,
  input: { from: string; to: string; body: string; statusCallback?: string },
  signal?: AbortSignal,
): Promise<string | null> {
  const res = await call("Twilio", `${TWILIO}/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
    method: "POST",
    headers: { Authorization: twilioAuth(accountSid, authToken), "Content-Type": "application/x-www-form-urlencoded" },
    body: form({
      To: input.to,
      Body: input.body,
      [input.from.startsWith("MG") ? "MessagingServiceSid" : "From"]: input.from,
      StatusCallback: input.statusCallback,
    }),
    signal,
  });
  const j = (await res.json().catch(() => ({}))) as { sid?: string };
  return j.sid ?? null;
}

/** Replaces what a live call is doing with new TwiML (the voicemail drop). */
export async function twilioUpdateCall(
  accountSid: string,
  authToken: string,
  callSid: string,
  twiml: string,
  signal?: AbortSignal,
): Promise<void> {
  await call(
    "Twilio",
    `${TWILIO}/Accounts/${encodeURIComponent(accountSid)}/Calls/${encodeURIComponent(callSid)}.json`,
    {
      method: "POST",
      headers: {
        Authorization: twilioAuth(accountSid, authToken),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form({ Twiml: twiml }),
      signal,
    },
  );
}

/** A recording's audio. Twilio's needs the account's auth; Telnyx's links are pre-signed. */
export async function downloadRecording(
  url: string,
  auth: { accountSid: string; authToken: string } | null,
  signal?: AbortSignal,
): Promise<{ body: Buffer; contentType: string }> {
  const target = new URL(url);
  const allowed = ["api.twilio.com", "s3.amazonaws.com"];
  if (
    target.protocol !== "https:" ||
    !(allowed.includes(target.hostname) || target.hostname.endsWith(".amazonaws.com") || target.hostname.endsWith(".telnyx.com"))
  ) {
    throw new ProviderError("Recording", 400, "not a provider address");
  }
  const res = await call("Recording", url, {
    headers: auth ? { Authorization: twilioAuth(auth.accountSid, auth.authToken) } : {},
    // Twilio answers with a redirect to its media store; fetch drops the
    // Authorization header when the redirect leaves the origin.
    redirect: "follow",
    signal,
  });
  const contentType = (res.headers.get("content-type") ?? "audio/mpeg").split(";")[0]!.trim();
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > 50 * 1024 * 1024) throw new ProviderError("Recording", 413, "too large");
  return { body, contentType };
}

// ---- Deepgram -------------------------------------------------------------------------

const DEEPGRAM = "https://api.deepgram.com/v1";

export async function deepgramCheck(apiKey: string, signal?: AbortSignal): Promise<void> {
  await call("Deepgram", `${DEEPGRAM}/projects`, { headers: { Authorization: `Token ${apiKey}` }, signal });
}

export interface Transcript {
  text: string;
  /** Speaker-labelled lines when Deepgram could tell the voices apart. */
  lines: { speaker: number; text: string }[];
  durationSec: number | null;
}

/** Batch transcription of a recording (pre-recorded audio, Nova). */
export async function deepgramTranscribe(
  apiKey: string,
  audio: { body: Buffer; contentType: string },
  signal?: AbortSignal,
): Promise<Transcript> {
  const params = new URLSearchParams({
    model: "nova-3",
    smart_format: "true",
    punctuate: "true",
    diarize: "true",
    paragraphs: "true",
  });
  const res = await call("Deepgram", `${DEEPGRAM}/listen?${params}`, {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": audio.contentType },
    body: new Uint8Array(audio.body),
    signal: signal ?? AbortSignal.timeout(110_000),
  });
  const j = (await res.json()) as {
    metadata?: { duration?: number };
    results?: {
      channels?: {
        alternatives?: {
          transcript?: string;
          paragraphs?: { paragraphs?: { speaker?: number; sentences?: { text?: string }[] }[] };
        }[];
      }[];
    };
  };
  const alt = j.results?.channels?.[0]?.alternatives?.[0];
  const lines =
    alt?.paragraphs?.paragraphs?.map((p) => ({
      speaker: p.speaker ?? 0,
      text: (p.sentences ?? []).map((s) => s.text ?? "").join(" ").trim(),
    })) ?? [];
  return {
    text: (alt?.transcript ?? "").trim(),
    lines: lines.filter((l) => l.text),
    durationSec: typeof j.metadata?.duration === "number" ? Math.round(j.metadata.duration) : null,
  };
}

/** "Speaker 1: ...\nSpeaker 2: ..." when there are speakers, else the plain text. */
export function transcriptText(t: Transcript): string {
  const speakers = new Set(t.lines.map((l) => l.speaker));
  if (t.lines.length === 0 || speakers.size < 2) return t.text;
  return t.lines.map((l) => `Speaker ${l.speaker + 1}: ${l.text}`).join("\n");
}
