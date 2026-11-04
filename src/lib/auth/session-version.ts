import { cache } from "react";

import { authDb } from "@/server/db/clients";

/*
 * Ending sessions server-side. Sessions are signed JWT cookies (config.ts),
 * so on their own they live out their 30 days. Each one carries the
 * account's sessionVersion (UserCredential.sessionVersion) from sign-in;
 * every check compares it with the database, and a password reset bumps the
 * version, which ends every session signed before it, an attacker's too.
 */

/** The account's session version, or null when the user no longer exists. */
export const loadSessionVersion = cache(async (userId: string): Promise<number | null> => {
  // One statement: this runs before anything else on every request.
  const rows = await authDb.$queryRaw<{ sessionVersion: number | null }[]>`
    SELECT c."sessionVersion"
    FROM "User" u LEFT JOIN "UserCredential" c ON c."userId" = u."id"
    WHERE u."id" = ${userId}`;
  const user = rows[0];
  if (!user) return null;
  return user.sessionVersion ?? 0;
});

/**
 * Whether a session token is still good: "end" when its user is gone or its
 * version is older than the account's. A token from before versions existed
 * reads as version 0. A database error keeps the session: Auth.js clears
 * the cookie when the callback throws, so failing closed here would sign
 * everyone out during a blip.
 */
export async function checkSessionVersion(
  token: { id?: unknown; sv?: unknown; [claim: string]: unknown },
  load: (userId: string) => Promise<number | null> = loadSessionVersion,
): Promise<"keep" | "end"> {
  if (typeof token.id !== "string") return "keep";
  let current: number | null;
  try {
    current = await load(token.id);
  } catch (error) {
    console.error(
      "[auth] could not check the session version",
      error instanceof Error ? error.message : error,
    );
    return "keep";
  }
  if (current === null) return "end";
  const signed = typeof token.sv === "number" ? token.sv : 0;
  return current === signed ? "keep" : "end";
}
