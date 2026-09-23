import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth, { CredentialsSignin, type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

import { verifyPassword } from "@/lib/auth/password";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { clientIpFrom } from "@/lib/request-ip";
import { authDb } from "@/server/db/clients";

/**
 * Credentials sign-in limits (Postgres-backed, shared by every instance;
 * counted on the auth role as their own statements, so failures count too).
 * Applied in authorize(), which both the sign-in form's Server Action and a
 * direct POST to /api/auth/callback/credentials go through.
 */
export const SIGN_IN_LIMITS = {
  perIp: { limit: 30, windowSec: 15 * 60 },
  perEmail: { limit: 10, windowSec: 15 * 60 },
} as const;

/** Thrown from authorize() when a limit is hit; the form shows a specific message. */
export class RateLimitedSignIn extends CredentialsSignin {
  code = "rate_limited";
}

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
      async authorize(credentials, request) {
        const rawEmail = typeof credentials?.email === "string" ? credentials.email : null;
        const password = typeof credentials?.password === "string" ? credentials.password : null;
        if (!rawEmail || !password) {
          return null;
        }
        // Emails are stored as lower(btrim()) (migration 0a_normalize_emails).
        const email = rawEmail.trim().toLowerCase();

        const ip = clientIpFrom(request.headers);
        const [byIp, byEmail] = await Promise.all([
          checkRateLimit(
            rateLimitKey("signin-ip", ip),
            SIGN_IN_LIMITS.perIp.limit,
            SIGN_IN_LIMITS.perIp.windowSec,
            { via: "auth" },
          ),
          checkRateLimit(
            rateLimitKey("signin-email", email),
            SIGN_IN_LIMITS.perEmail.limit,
            SIGN_IN_LIMITS.perEmail.windowSec,
            { via: "auth" },
          ),
        ]);
        if (!byIp.allowed || !byEmail.allowed) {
          throw new RateLimitedSignIn();
        }

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
