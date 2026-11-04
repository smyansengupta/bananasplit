import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { CALLBACK_HEADER, signInPath } from "@/lib/auth/callback-url";
import { auth } from "@/lib/auth/config";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

export interface Session {
  user: SessionUser;
}

/**
 * Once per request (React cache()): every withOrgTx asks for the user, and
 * auth() decrypts and re-signs the session cookie each time it runs.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return null;
  }
  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name ?? null,
    },
  };
});

/**
 * The signed-in user, or a redirect to sign-in that carries a callbackUrl
 * back to the requested page (a same-origin relative path; the proxy passes
 * the path in x-pathname), so an email deep link lands on its task after
 * sign-in.
 */
export async function requireUser(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) {
    redirect(signInPath(await requestedPath()));
  }
  return session.user;
}

async function requestedPath(): Promise<string | null> {
  try {
    return (await headers()).get(CALLBACK_HEADER);
  } catch {
    return null; // outside a request
  }
}
