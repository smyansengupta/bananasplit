"use server";

import { requireUser } from "@/lib/auth/session";
import { generateIcsToken, hashIcsToken } from "@/lib/ics-token";
import { prisma } from "@/lib/prisma";

/**
 * The per-user ICS feed token (0A/0B, decision D3). Only sha256(token) is
 * stored, in UserCredential, which no tenant role can read: request code
 * reaches the caller's own row only through app.set_ics_token_hash() and
 * app.ics_token_created_at(), keyed on app.user_id(). The plaintext token
 * exists only in the URL returned once by regenerateIcsToken().
 *
 * Legacy path (app_legacy): a short transaction that sets the user context
 * with app.set_context(userId, NULL) first. Profiles (Phase 2) moves this to
 * withUserTx on app_user.
 */

/** When the current feed link was created, or null when there is none. */
export async function getIcsFeedActiveSince(): Promise<Date | null> {
  const user = await requireUser();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT app.set_context(${user.id}, NULL)::text AS role`;
    const rows = await tx.$queryRaw<{ t: Date | null }[]>`SELECT app.ics_token_created_at() AS t`;
    return rows[0]?.t ?? null;
  });
}

/**
 * Creates a new feed token (invalidating the old link) and returns the
 * plaintext once. The caller shows it to the user immediately.
 */
export async function regenerateIcsToken(): Promise<string> {
  const user = await requireUser();
  const token = generateIcsToken();
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT app.set_context(${user.id}, NULL)::text AS role`;
    await tx.$queryRaw`SELECT app.set_ics_token_hash(${hashIcsToken(token)}) AS t`;
  });
  return token;
}
