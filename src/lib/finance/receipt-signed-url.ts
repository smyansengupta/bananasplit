import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_MS = 5 * 60 * 1000;

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required to sign receipt URLs");
  return secret;
}

/** Short-lived (5 min) signed token for a receipt download link (spec 5.5). */
export function signReceiptToken(receiptId: string): string {
  const expires = Date.now() + TTL_MS;
  const mac = createHmac("sha256", getSecret()).update(`${receiptId}.${expires}`).digest("hex");
  return `${expires}.${mac}`;
}

export function verifyReceiptToken(receiptId: string, token: string): boolean {
  const dotIndex = token.indexOf(".");
  if (dotIndex === -1) return false;

  const expires = Number(token.slice(0, dotIndex));
  const providedMac = token.slice(dotIndex + 1);
  if (!Number.isFinite(expires) || expires < Date.now()) return false;

  const expectedMac = createHmac("sha256", getSecret())
    .update(`${receiptId}.${expires}`)
    .digest("hex");
  const provided = Buffer.from(providedMac);
  const expected = Buffer.from(expectedMac);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
