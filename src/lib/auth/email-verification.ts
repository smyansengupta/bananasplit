import { createHash, randomBytes } from "node:crypto";

import { absoluteAppUrl } from "@/lib/app-url";
import { normalizeEmail } from "@/lib/auth/normalize-email";
import { sendNotificationEmail } from "@/lib/email";
import { authDb } from "@/server/db/clients";

/**
 * Email verification for credentials sign-up (0A Fix 4(b)). An address is
 * only trusted once its owner has opened a link sent to it; until then the
 * account can sign in but cannot hold a Membership (no org creation, no
 * invitation acceptance: Fix 4(c)).
 *
 * Tokens use the Auth.js VerificationToken table (identifier = the
 * normalized email). Only sha256(token) is stored; the plaintext exists
 * only in the emailed link. A new token replaces any older one for the same
 * address, and consuming one deletes them all. Everything here runs as
 * app_auth (authDb), the identity role.
 */

export const VERIFICATION_TTL_HOURS = 24;

export function hashVerificationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Creates a fresh token for `email` (dropping older ones) and returns the plaintext. */
export async function issueEmailVerification(email: string): Promise<string> {
  const identifier = normalizeEmail(email);
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + VERIFICATION_TTL_HOURS * 60 * 60 * 1000);
  await authDb.$transaction([
    authDb.verificationToken.deleteMany({ where: { identifier } }),
    authDb.verificationToken.create({
      data: { identifier, token: hashVerificationToken(token), expires },
    }),
  ]);
  return token;
}

export function verificationUrl(token: string): string {
  return absoluteAppUrl(`/verify-email/${token}`);
}

/**
 * Sends the link through the platform mailer (@/lib/email). With no Resend
 * key outside production, the link is also printed to the server console so
 * local development and e2e runs can verify without a mail provider.
 */
export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const url = verificationUrl(token);
  await sendNotificationEmail({
    to: email,
    title: "Verify your email for CBC Portal",
    body: `Open this link to verify your email address: ${url} (it expires in ${VERIFICATION_TTL_HOURS} hours). If you didn't create a CBC Portal account, you can ignore this email.`,
  });
  if (process.env.NODE_ENV !== "production" && !process.env.RESEND_API_KEY) {
    console.info(`[verify-email] verification link for ${email}: ${url}`);
  }
}

export type ConsumeVerificationResult =
  | { ok: true; email: string }
  | { ok: false; reason: "invalid" | "expired" };

/**
 * Marks the address behind `token` verified. Idempotent for an already
 * verified account (the timestamp is kept). A token is single-use.
 */
export async function consumeEmailVerification(token: string): Promise<ConsumeVerificationResult> {
  if (!token || token.length > 200) return { ok: false, reason: "invalid" };
  const tokenHash = hashVerificationToken(token);
  return authDb.$transaction(async (tx) => {
    const row = await tx.verificationToken.findFirst({ where: { token: tokenHash } });
    if (!row) return { ok: false as const, reason: "invalid" as const };
    if (row.expires < new Date()) {
      await tx.verificationToken.deleteMany({ where: { identifier: row.identifier, token: tokenHash } });
      return { ok: false as const, reason: "expired" as const };
    }
    await tx.user.updateMany({
      where: { email: row.identifier, emailVerified: null },
      data: { emailVerified: new Date() },
    });
    await tx.verificationToken.deleteMany({ where: { identifier: row.identifier } });
    return { ok: true as const, email: row.identifier };
  });
}

export interface UserIdentity {
  id: string;
  email: string;
  emailVerified: Date | null;
}

/** The stored (normalized) email and its verification state for a user. */
export async function getUserIdentity(userId: string): Promise<UserIdentity | null> {
  return authDb.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, emailVerified: true },
  });
}
