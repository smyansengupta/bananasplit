import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/config";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

export interface Session {
  user: SessionUser;
}

export async function getSession(): Promise<Session | null> {
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
}

export async function requireUser(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) {
    redirect("/sign-in");
  }
  return session.user;
}
