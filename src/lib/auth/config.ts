import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

import { verifyPassword } from "@/lib/auth/password";
import { authDb } from "@/server/db/clients";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // The identity plane runs as app_auth: grants on User, Account, Session,
  // VerificationToken and UserCredential only, and no tenant access.
  adapter: PrismaAdapter(authDb),
  // Credentials sign-in only persists sessions with the JWT strategy — the
  // adapter still manages User/Account rows for Google, only session storage
  // moves from a Session table row to a signed cookie.
  session: { strategy: "jwt" },
  pages: {
    signIn: "/sign-in",
  },
  providers: [
    // Client ID/secret are read from AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET.
    // Only the three non-sensitive scopes below — no Calendar access, no
    // Google verification review required (see spec section 11, item 1).
    Google({
      authorization: {
        params: { scope: "openid email profile" },
      },
    }),
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const rawEmail = typeof credentials?.email === "string" ? credentials.email : null;
        const password = typeof credentials?.password === "string" ? credentials.password : null;
        if (!rawEmail || !password) {
          return null;
        }
        // Emails are stored as lower(btrim()) (migration 0a_normalize_emails).
        const email = rawEmail.trim().toLowerCase();

        // The password hash lives in UserCredential, which only app_auth can read.
        const user = await authDb.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            name: true,
            image: true,
            credential: { select: { passwordHash: true } },
          },
        });
        const passwordHash = user?.credential?.passwordHash;
        if (!user || !passwordHash) {
          return null;
        }

        const valid = await verifyPassword(password, passwordHash);
        if (!valid) {
          return null;
        }

        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (typeof token.id === "string") {
        session.user.id = token.id;
      }
      return session;
    },
  },
});
