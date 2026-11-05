import { createHash, createHmac, randomBytes } from "node:crypto";

/**
 * A guest's link to their booking (/book/m/{token}): an HMAC of the
 * booking's id (AUTH_SECRET), so the email job can rebuild it from the id
 * alone and no job payload or row ever holds it. The row keeps its sha256,
 * which is how app.crm_public_target('booking-guest', hash) finds the
 * booking's organization. Server-only.
 */

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is required to sign meeting links");
  return value;
}

export const BOOKING_TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

/** A new booking's id (made here so its token can be too). */
export function newBookingId(): string {
  return `bk${randomBytes(12).toString("hex")}`;
}

export function bookingToken(bookingId: string): string {
  return createHmac("sha256", secret()).update(`booking-guest:${bookingId}`).digest("base64url").slice(0, 32);
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
