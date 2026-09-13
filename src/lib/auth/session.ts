import { redirect } from "next/navigation";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

export interface Session {
  user: SessionUser;
}

/**
 * Resolves the current session. Returns null until Phase 1.1 wires up Auth.js
 * (this becomes a thin call to `auth()`) — every caller already handles the
 * null case correctly via requireUser().
 */
export async function getSession(): Promise<Session | null> {
  return null;
}

export async function requireUser(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) {
    redirect("/sign-in");
  }
  return session.user;
}
