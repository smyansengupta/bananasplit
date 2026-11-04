import { createHash, randomBytes } from "node:crypto";

/**
 * A report's view-only link token (/r/{token}): 32 random bytes,
 * base64url. Only sha256(token) as lowercase hex is stored
 * (Report.linkTokenHash); the token itself is shown once, in the link, to
 * the editor who turned the link on or made a new one.
 */

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function generateShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Shaped like a token we'd make (anything else is not looked up). */
export function isShareToken(token: string): boolean {
  return TOKEN.test(token);
}
