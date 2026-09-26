import { createHash, randomBytes } from "node:crypto";

/**
 * Per-user ICS feed tokens. The plaintext token lives only in the feed URL;
 * the database stores sha256(token) as lowercase hex in
 * UserCredential.icsTokenHash (the format app.set_ics_token_hash accepts).
 */
export function generateIcsToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashIcsToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
