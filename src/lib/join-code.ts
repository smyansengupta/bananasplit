import { randomInt } from "node:crypto";

/**
 * Org invite codes (OrgJoinCode.code): XXXX-XXXX from a 31-letter alphabet
 * with no 0/O, 1/I/L or U, about 8.5e11 codes, looked up only by signed-in,
 * verified users and rate limited per user.
 */

const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

export const JOIN_CODE_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export function generateJoinCode(): string {
  let out = "";
  for (let i = 0; i < 8; i++) {
    if (i === 4) out += "-";
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}

/** " abcd efgh " / "abcdefgh" -> "ABCD-EFGH"; null when it can't be a code. */
export function normalizeJoinCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length !== 8) return null;
  const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
  return JOIN_CODE_RE.test(code) ? code : null;
}

/** "@Northeastern.edu " -> "northeastern.edu"; null when blank or not a domain. */
export function normalizeDomain(input: string | null | undefined): string | null {
  const d = (input ?? "").trim().toLowerCase().replace(/^@/, "");
  if (!d) return null;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d) ? d : null;
}

/** Whether `email` is on `domain` or one of its subdomains. */
export function emailOnDomain(email: string, domain: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const host = email.slice(at + 1).trim().toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}
