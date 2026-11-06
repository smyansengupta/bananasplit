import { createHmac, createPublicKey, timingSafeEqual, verify } from "node:crypto";

/**
 * Checking that a provider webhook really came from the provider, before
 * anything else happens (docs/features/crm.md, Phase 5):
 *
 * - Telnyx signs `${timestamp}|${rawBody}` with ed25519; the organization
 *   pastes its account's public key (Mission Control, Keys and credentials,
 *   Public key) on the Telnyx card. Headers telnyx-signature-ed25519
 *   (base64) and telnyx-timestamp (unix seconds); older than five minutes
 *   is refused, so a captured request can't be replayed later.
 * - Twilio signs the full URL it called followed by every POST parameter
 *   (sorted by name, name then value, no separators) with HMAC-SHA1 under
 *   the account's auth token; header X-Twilio-Signature (base64).
 *
 * Pure: the routes pass the raw body, headers and the secret they loaded.
 */

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** Telnyx's ed25519 public key (base64 of the 32 raw bytes) as a key object, or null. */
function ed25519Key(publicKeyBase64: string) {
  try {
    const raw = Buffer.from(publicKeyBase64.trim(), "base64");
    if (raw.length !== 32) return null;
    return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: "der", type: "spki" });
  } catch {
    return null;
  }
}

/** A Telnyx public key as pasted: 32 bytes in base64. */
export function isTelnyxPublicKey(value: string): boolean {
  return ed25519Key(value) !== null;
}

export const TELNYX_TOLERANCE_SEC = 300;

export function verifyTelnyx(input: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  publicKey: string | null | undefined;
  now?: number;
}): boolean {
  const { rawBody, signature, timestamp, publicKey } = input;
  if (!signature || !timestamp || !publicKey) return false;
  if (!/^\d{9,11}$/.test(timestamp)) return false;
  const now = Math.floor((input.now ?? Date.now()) / 1000);
  if (Math.abs(now - Number(timestamp)) > TELNYX_TOLERANCE_SEC) return false;
  const key = ed25519Key(publicKey);
  if (!key) return false;
  let sig: Buffer;
  try {
    sig = Buffer.from(signature, "base64");
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;
  try {
    return verify(null, Buffer.from(`${timestamp}|${rawBody}`, "utf8"), key, sig);
  } catch {
    return false;
  }
}

/** Twilio's expected signature for a form POST to `url`. */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf8")).digest("base64");
}

export function verifyTwilio(input: {
  url: string;
  params: Record<string, string>;
  signature: string | null;
  authToken: string | null | undefined;
}): boolean {
  const { url, params, signature, authToken } = input;
  if (!signature || !authToken) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** A form body as Twilio sends it, into name/value pairs (repeated names keep the last). */
export function formParams(rawBody: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(rawBody)) out[k] = v;
  return out;
}
