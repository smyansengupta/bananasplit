import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "active_org";

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is required to sign the active-org cookie");
  }
  return secret;
}

function sign(orgId: string): string {
  const mac = createHmac("sha256", getSecret()).update(orgId).digest("hex");
  return `${orgId}.${mac}`;
}

/** Persists the user's active org as a convenience for the next bare /app visit. */
export async function setActiveOrgCookie(orgId: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, sign(orgId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

/**
 * Reads the active-org cookie, verifying its signature. This is a UX
 * shortcut only — callers must still verify membership before using the
 * returned id for anything. An edited or forged cookie just fails
 * verification (returns null) rather than granting access to anything.
 */
export async function getActiveOrgId(): Promise<string | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;

  const separatorIndex = raw.lastIndexOf(".");
  if (separatorIndex === -1) return null;
  const orgId = raw.slice(0, separatorIndex);
  const providedMac = raw.slice(separatorIndex + 1);

  const expectedMac = createHmac("sha256", getSecret()).update(orgId).digest("hex");
  const provided = Buffer.from(providedMac);
  const expected = Buffer.from(expectedMac);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }
  return orgId;
}
