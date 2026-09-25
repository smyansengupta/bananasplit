import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_MS = 5 * 60 * 1000;

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required to sign receipt URLs");
  return secret;
}

function mac(receiptId: string, organizationId: string, expires: number): string {
  return createHmac("sha256", getSecret())
    .update(`${receiptId}.${organizationId}.${expires}`)
    .digest("hex");
}

/**
 * Short-lived (5 min) signed token for a receipt download link (spec 5.5).
 * It binds the receipt and its org: the download route opens its read
 * transaction in that org (RLS then decides whether the caller may see the
 * receipt), so the org must come from the server, not from an edited link.
 */
export function signReceiptToken(receiptId: string, organizationId: string): string {
  const expires = Date.now() + TTL_MS;
  return `${expires}.${mac(receiptId, organizationId, expires)}`;
}

export function verifyReceiptToken(
  receiptId: string,
  organizationId: string,
  token: string,
): boolean {
  const dotIndex = token.indexOf(".");
  if (dotIndex === -1) return false;

  const expires = Number(token.slice(0, dotIndex));
  const providedMac = token.slice(dotIndex + 1);
  if (!Number.isFinite(expires) || expires < Date.now()) return false;

  const provided = Buffer.from(providedMac);
  const expected = Buffer.from(mac(receiptId, organizationId, expires));
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

/** The download link for a receipt, signed for `organizationId`. */
export function receiptDownloadUrl(receiptId: string, organizationId: string): string {
  const params = new URLSearchParams({
    org: organizationId,
    token: signReceiptToken(receiptId, organizationId),
  });
  return `/api/finance/receipts/${receiptId}?${params.toString()}`;
}
