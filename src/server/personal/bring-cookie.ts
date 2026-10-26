import { cookies } from "next/headers";

/**
 * "Start a club with this": the Personal item someone was looking
 * at when they chose to start a club (Move to a club, an upgrade prompt).
 * It waits in a short-lived cookie through club setup, and the last step
 * ("Bring anything in?") starts with it checked. Only an id: the step
 * checks it against the user's own Personal items before using it.
 */

const COOKIE = "bs_bring";
const MAX_AGE_SECONDS = 2 * 60 * 60;
const ID = /^[A-Za-z0-9_-]{1,100}$/;

export function isBringId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

/** Remembers the item (Server Actions and Route Handlers only). */
export async function rememberBring(id: string): Promise<void> {
  if (!isBringId(id)) return;
  (await cookies()).set(COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

/** The remembered item, or null. */
export async function readBring(): Promise<string | null> {
  const value = (await cookies()).get(COOKIE)?.value;
  return isBringId(value) ? value : null;
}

/** Forgets it (Server Actions and Route Handlers only). */
export async function clearBring(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
