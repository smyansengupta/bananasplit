import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { appUrl } from "@/lib/app-url";

/**
 * The CRM's public tokens. Server-only.
 *
 * - Stored as a hash, looked up through app.crm_public_target: guest links
 *   (/g/{token}) and self-update links (/c/{token}). Both tokens are
 *   derived (an HMAC of the row under AUTH_SECRET), so a member can copy a
 *   guest link again and every RSVP or form receipt can carry the same
 *   self-update link without writing anything; revoking clears the hash.
 * - Signed, nothing stored: unsubscribe links (/u/{token}, the org and the
 *   person in the clear plus a MAC) and click redirects (the URL's MAC
 *   under the message's tracking token, so the redirect is never open).
 * - Random, stored as is: an email's tracking token, which is also its
 *   reply+{token}@ Reply-To address, and a member's BCC token.
 */

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is required for CRM links");
  return value;
}

function mac(purpose: string, ...parts: string[]): string {
  return createHmac("sha256", secret()).update([purpose, ...parts].join(":")).digest("base64url");
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** A random URL-safe token. */
export function randomToken(bytes = 18): string {
  return randomBytes(bytes).toString("base64url");
}

/** A lowercase token for an email local part (log+{token}, reply+{token}). */
export function mailToken(): string {
  return randomBytes(12).toString("hex");
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

// ---- Derived, stored as a hash ---------------------------------------------------

export function guestToken(linkId: string): string {
  return mac("crm-guest", linkId).slice(0, 40);
}

export function selfUpdateToken(organizationId: string, personId: string): string {
  return mac("crm-self", organizationId, personId).slice(0, 40);
}

export const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

export function guestUrl(linkId: string): string {
  return appUrl(`/g/${guestToken(linkId)}`);
}

export function selfUpdateUrl(organizationId: string, personId: string): string {
  return appUrl(`/c/${selfUpdateToken(organizationId, personId)}`);
}

// ---- Signed, nothing stored --------------------------------------------------------

export function unsubscribeToken(organizationId: string, personId: string): string {
  return `${organizationId}.${personId}.${mac("crm-unsub", organizationId, personId).slice(0, 24)}`;
}

export function readUnsubscribeToken(token: string): { organizationId: string; personId: string } | null {
  const [org, person, sig, ...rest] = token.split(".");
  if (rest.length || !org || !person || !sig || !ID.test(org) || !ID.test(person)) return null;
  return same(sig, mac("crm-unsub", org, person).slice(0, 24)) ? { organizationId: org, personId: person } : null;
}

export function unsubscribeUrl(organizationId: string, personId: string): string {
  return appUrl(`/u/${unsubscribeToken(organizationId, personId)}`);
}

/** The one-click (RFC 8058) endpoint a mail client POSTs to. */
export function oneClickUrl(organizationId: string, personId: string): string {
  return appUrl(`/api/crm/u/${unsubscribeToken(organizationId, personId)}`);
}

export function clickSignature(trackingToken: string, url: string): string {
  return mac("crm-click", trackingToken, url).slice(0, 22);
}

export function clickUrl(trackingToken: string, url: string): string {
  const q = new URLSearchParams({ u: url, s: clickSignature(trackingToken, url) });
  return appUrl(`/api/crm/t/${trackingToken}/c?${q.toString()}`);
}

export function checkClick(trackingToken: string, url: string, signature: string): boolean {
  return same(signature, clickSignature(trackingToken, url));
}

export function pixelUrl(trackingToken: string): string {
  return appUrl(`/api/crm/t/${trackingToken}/o`);
}
