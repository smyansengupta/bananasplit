import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed export download links (Settings > Danger zone > Export).
 *
 * The signature binds (exportId, userId, exp) and expires after 24 hours.
 * It is minted only by the signed-in OWNER's landing page
 * (/app/[orgSlug]/settings/danger/exports/[exportId]) for that user, and the
 * download route requires, all together: a session for the same user, OWNER
 * in the org at download time, a valid unexpired signature and a READY
 * export. A forwarded email or link alone downloads nothing.
 */

export const EXPORT_LINK_TTL_MS = 24 * 60 * 60 * 1000;

function key(env: Record<string, string | undefined> = process.env): Buffer {
  const secret = env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required to sign export links");
  // Domain-separated from the other AUTH_SECRET uses (cookies, receipts).
  return createHmac("sha256", secret).update("cbc-export-download:v1").digest();
}

function mac(
  exportId: string,
  userId: string,
  exp: number,
  env?: Record<string, string | undefined>,
): string {
  return createHmac("sha256", key(env)).update(`${exportId}|${userId}|${exp}`).digest("base64url");
}

export interface SignedExportLink {
  exp: number;
  sig: string;
}

export function signExportDownload(
  exportId: string,
  userId: string,
  now = Date.now(),
  env?: Record<string, string | undefined>,
): SignedExportLink {
  const exp = now + EXPORT_LINK_TTL_MS;
  return { exp, sig: mac(exportId, userId, exp, env) };
}

export function verifyExportDownload(
  exportId: string,
  userId: string,
  exp: number,
  sig: string,
  now = Date.now(),
  env?: Record<string, string | undefined>,
): boolean {
  if (!Number.isFinite(exp) || exp < now || exp > now + EXPORT_LINK_TTL_MS + 60_000) return false;
  if (!sig || sig.length > 100) return false;
  const expected = Buffer.from(mac(exportId, userId, exp, env));
  const provided = Buffer.from(sig);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function exportDownloadPath(
  orgId: string,
  exportId: string,
  link: SignedExportLink,
): string {
  const q = new URLSearchParams({ exp: String(link.exp), sig: link.sig });
  return `/api/orgs/${encodeURIComponent(orgId)}/exports/${encodeURIComponent(exportId)}/download?${q}`;
}
