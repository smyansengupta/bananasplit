import { createHmac } from "node:crypto";

import { SecretsConfigError } from "./keyring";

/**
 * Display metadata for a secret, stored in OrgIntegration (readable by the
 * org's admins; never the secret itself):
 * - secretFingerprint: HMAC-SHA256 under SECRETS_FINGERPRINT_KEY, so an admin
 *   can tell whether two saves used the same key without anyone being able
 *   to recover or brute-check it offline without the platform key.
 * - secretLast4: the last four characters, only for secrets long enough
 *   that four characters reveal nothing useful (API keys, tokens).
 */

export function secretFingerprint(
  value: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const key = env.SECRETS_FINGERPRINT_KEY;
  if (!key) throw new SecretsConfigError("SECRETS_FINGERPRINT_KEY is not set");
  return createHmac("sha256", key).update(value, "utf8").digest("hex").slice(0, 32);
}

export function secretLast4(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length >= 16 ? trimmed.slice(-4) : null;
}
