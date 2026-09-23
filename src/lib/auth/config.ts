import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

import {
  googleProviderOptions,
  googleSignInGate,
  markGoogleEmailVerified,
  withNormalizedEmails,
} from "@/lib/auth/google-linking";
import { normalizeEmail } from "@/lib/auth/normalize-email";
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
  // VerificationToken and UserCredential only, and no tenant access. Every
  // email the adapter writes or looks up is normalized (0A Fix 4(a)).
  adapter: withNormalizedEmails(PrismaAdapter(authDb)),
  // Credentials sign-in only persists sessions with the JWT strategy — the
  // adapter still manages User/Account rows for Google, only session storage
  // moves from a Session table row to a signed cookie.
  session: { strategy: "jwt" },
  pages: {
    signIn: "/sign-in",
    // Auth errors (OAuthAccountNotLinked, AccessDenied) land on the sign-in
    // page, which explains them.
    error: "/sign-in",
  },
  providers: [
    // Client ID/secret are read from AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET.
    // Only the three non-sensitive scopes — no Calendar access, no Google
    // verification review required (see spec section 11, item 1). Email
    // account linking is allowed because both sides must have verified the
    // address first (0A Fix 4(d); see google-linking.ts).
    Google(googleProviderOptions),
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
        const email = normalizeEmail(rawEmail);

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
    // Refuses a Google sign-in without a verified address, and clears an
    // unverified password account squatting on it before Auth.js links.
    signIn: ({ account, profile }) => googleSignInGate({ account, profile }),
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
  events: {
    signIn: ({ user, account, profile }) => markGoogleEmailVerified({ user, account, profile }),
  },
});
