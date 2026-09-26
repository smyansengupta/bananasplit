import { createHash } from "node:crypto";

import { authDb } from "@/server/db/clients";
import { enqueueJob } from "@/server/jobs/enqueue";

/**
 * Email verification for credentials sign-ups (0A Fix 4(b)), on the
 * identity plane (app_auth):
 *
 * - enqueueVerificationEmail(userId): a verify-email platform job (the job
 *   mints the token and sends the link; see ./jobs.ts). Call it after the
 *   sign-up write and from "resend verification".
 * - consumeVerificationToken(rawToken): for the /verify-email/[token] page.
 *   Marks the user verified when the token's hash matches an unexpired
 *   VerificationToken, and deletes the user's tokens. Single use.
 */

export async function enqueueVerificationEmail(userId: string): Promise<void> {
  await enqueueJob(authDb, {
    orgId: null,
    kind: "verify-email",
    key: userId,
    payload: { userId },
  });
}

export type VerifyResult = { ok: true; email: string } | { ok: false; reason: "invalid" | "expired" };

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,200}$/;

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Whether a link's token is usable, without consuming it. The page shows a
 * "Confirm" button and consumes only on POST, so a mail scanner that
 * prefetches the link cannot use it up.
 */
export async function peekVerificationToken(rawToken: string): Promise<"valid" | "expired" | "invalid"> {
  if (!TOKEN_SHAPE.test(rawToken)) return "invalid";
  const row = await authDb.verificationToken.findFirst({
    where: { token: hashToken(rawToken) },
    select: { expires: true },
  });
  if (!row) return "invalid";
  return row.expires <= new Date() ? "expired" : "valid";
}

export async function consumeVerificationToken(rawToken: string): Promise<VerifyResult> {
  if (!TOKEN_SHAPE.test(rawToken)) return { ok: false, reason: "invalid" };
  const tokenHash = hashToken(rawToken);

  return authDb.$transaction(async (tx) => {
    const row = await tx.verificationToken.findFirst({ where: { token: tokenHash } });
    if (!row) return { ok: false, reason: "invalid" } as const;
    await tx.verificationToken.deleteMany({ where: { identifier: row.identifier } });
    if (row.expires <= new Date()) return { ok: false, reason: "expired" } as const;
    const updated = await tx.user.updateMany({
      where: { email: row.identifier, emailVerified: null },
      data: { emailVerified: new Date() },
    });
    if (updated.count === 0) {
      const exists = await tx.user.findUnique({ where: { email: row.identifier }, select: { id: true } });
      if (!exists) return { ok: false, reason: "invalid" } as const;
    }
    return { ok: true, email: row.identifier } as const;
  });
}
