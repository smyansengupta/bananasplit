import { createHash } from "node:crypto";

import { hashPassword } from "@/lib/auth/password";
import {
  forgetAtWorkosAfterResponse,
  revokeAllConnectorGrants,
  type RevokedGrant,
} from "@/server/connectors/revoke";
import { authDb } from "@/server/db/clients";
import { enqueueJob } from "@/server/jobs/enqueue";

/**
 * Password reset (docs/features/accounts.md), on the identity plane
 * (app_auth), shaped like email verification (./verification.ts):
 *
 * - requestPasswordReset(email): queues a password-reset-email job for the
 *   account with that address, if there is one. The caller answers the same
 *   either way, so nobody learns whether an address has an account.
 * - peekPasswordResetToken(raw): whether a link works, without using it up
 *   (the page consumes only on POST, so mail scanners can't spend it).
 * - resetPassword(raw, password): single use. Sets the new password, bumps
 *   the session version (every existing session ends), revokes every AI
 *   app the account connected (docs/features/ai-connectors.md), marks the
 *   address verified (the link proved it), and clears the user's other
 *   links.
 */

/** How long a reset link works. */
export const PASSWORD_RESET_TTL_MINUTES = 60;

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,200}$/;

export function hashResetToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export async function requestPasswordReset(email: string): Promise<void> {
  const user = await authDb.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return;
  await enqueueJob(authDb, {
    orgId: null,
    kind: "password-reset-email",
    key: user.id,
    payload: { userId: user.id },
  });
}

export async function peekPasswordResetToken(
  rawToken: string,
): Promise<"valid" | "expired" | "invalid"> {
  if (!TOKEN_SHAPE.test(rawToken)) return "invalid";
  const row = await authDb.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(rawToken) },
    select: { expiresAt: true },
  });
  if (!row) return "invalid";
  return row.expiresAt <= new Date() ? "expired" : "valid";
}

export type ResetResult =
  { ok: true; userId: string } | { ok: false; reason: "invalid" | "expired" };

export async function resetPassword(rawToken: string, password: string): Promise<ResetResult> {
  if (!TOKEN_SHAPE.test(rawToken)) return { ok: false, reason: "invalid" };
  const tokenHash = hashResetToken(rawToken);
  // Hashed before the transaction: bcrypt is slow, and the token row stays
  // locked for as short a time as possible.
  const passwordHash = await hashPassword(password);

  let revoked: RevokedGrant[] = [];
  const result = await authDb.$transaction(async (tx) => {
    const row = await tx.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true },
    });
    if (!row) return { ok: false, reason: "invalid" } as const;
    // Claiming the row is the single-use guarantee: of two concurrent
    // submissions, only one deletes it.
    const claimed = await tx.passwordResetToken.deleteMany({ where: { id: row.id } });
    if (claimed.count === 0) return { ok: false, reason: "invalid" } as const;
    if (row.expiresAt <= new Date()) return { ok: false, reason: "expired" } as const;

    await tx.userCredential.upsert({
      where: { userId: row.userId },
      create: { userId: row.userId, passwordHash, sessionVersion: 1 },
      update: { passwordHash, sessionVersion: { increment: 1 } },
    });
    // Whoever reset the password may not be whoever connected the account's
    // AI apps: they stop working until the member connects them again.
    revoked = await revokeAllConnectorGrants(tx, row.userId);
    await tx.user.updateMany({
      where: { id: row.userId, emailVerified: null },
      data: { emailVerified: new Date() },
    });
    const user = await tx.user.findUniqueOrThrow({
      where: { id: row.userId },
      select: { email: true },
    });
    await tx.passwordResetToken.deleteMany({ where: { userId: row.userId } });
    await tx.verificationToken.deleteMany({ where: { identifier: user.email } });
    return { ok: true, userId: row.userId } as const;
  });
  if (result.ok) forgetAtWorkosAfterResponse(revoked);
  return result;
}

/** The "your password was changed" notice, queued after a successful reset. */
export async function enqueuePasswordChangedEmail(userId: string): Promise<void> {
  await enqueueJob(authDb, {
    orgId: null,
    kind: "password-changed-email",
    key: userId,
    payload: { userId },
  });
}
