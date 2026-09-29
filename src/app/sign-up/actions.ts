"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { credentialsSignIn, SIGN_IN_UNAVAILABLE_MESSAGE } from "@/lib/auth/credentials-sign-in";
import { emailVerificationRequired } from "@/lib/auth/email-verification";
import { hashPassword } from "@/lib/auth/password";
import { checkRateLimit, rateLimitKey, retryAfterText } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { authDb } from "@/server/db/clients";
import { enqueueVerificationEmail } from "@/server/email/verification";

/** Sign-up limits: per client IP and per normalized email (Postgres-backed). */
const SIGN_UP_LIMITS = {
  perIp: { limit: 5, windowSec: 60 * 60 },
  perEmail: { limit: 3, windowSec: 60 * 60 },
} as const;

const signUpSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  // Stored as lower(btrim()), like every email (0a_normalize_emails).
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
});

export interface SignUpState {
  error?: string;
  /**
   * The account exists and a verification link was sent to this address,
   * but the user is not signed in (the automatic sign-in failed; `error`
   * says so when the server could not sign anyone in).
   */
  checkEmail?: string;
}

/**
 * Credentials sign-up (0A Fix 4(b)). The account is created unverified and a
 * verification link goes to the address; the user is signed in right away
 * and lands on onboarding, which shows the 'check your email' state. An
 * unverified account can sign in but cannot create or join an organization
 * (Fix 4(c)), and an abandoned one is purged after 72 hours.
 */
export async function signUpAction(
  _prevState: SignUpState,
  formData: FormData,
): Promise<SignUpState> {
  const parsed = signUpSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const ip = await getClientIp();
  const [byIp, byEmail] = await Promise.all([
    checkRateLimit(
      rateLimitKey("signup-ip", ip),
      SIGN_UP_LIMITS.perIp.limit,
      SIGN_UP_LIMITS.perIp.windowSec,
      { via: "auth" },
    ),
    checkRateLimit(
      rateLimitKey("signup-email", parsed.data.email),
      SIGN_UP_LIMITS.perEmail.limit,
      SIGN_UP_LIMITS.perEmail.windowSec,
      { via: "auth" },
    ),
  ]);
  const limited = !byIp.allowed ? byIp : !byEmail.allowed ? byEmail : null;
  if (limited) {
    return { error: `Too many sign-up attempts. Try again ${retryAfterText(limited)}.` };
  }

  // Identity writes run as app_auth; the hash goes to UserCredential, which
  // no tenant role can read.
  const existing = await authDb.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true },
  });
  if (existing) {
    return { error: "An account with this email already exists." };
  }

  const passwordHash = await hashPassword(parsed.data.password);
  // Local development has no sender, so the link would never arrive: the
  // address counts as confirmed and the account goes straight to onboarding
  // (see emailVerificationRequired; a deployment always verifies).
  const mustVerify = emailVerificationRequired();
  const user = await authDb.user.create({
    data: {
      email: parsed.data.email,
      name: parsed.data.name,
      emailVerified: mustVerify ? null : new Date(),
      credential: { create: { passwordHash } },
    },
    select: { id: true },
  });

  // The confirmation link goes out through the outbox (a verify-email
  // platform job, sent right after this request). An account that is never
  // confirmed, and never joins an org, is removed after 72 hours.
  // If queueing fails the account exists either way; onboarding offers
  // "Resend verification email".
  if (mustVerify) {
    try {
      await enqueueVerificationEmail(user.id);
    } catch (error) {
      console.error("[sign-up] could not queue the verification email", error instanceof Error ? error.message : error);
    }
  }

  const signedIn = await credentialsSignIn(parsed.data.email, parsed.data.password, "/onboarding");
  if (signedIn.ok) redirect("/onboarding");

  // The account exists either way. A server-side failure is said as such
  // (it is not the password); anything else falls back to signing in by hand.
  const unavailable =
    signedIn.reason === "unavailable"
      ? `Your account was created, but we couldn't sign you in. ${SIGN_IN_UNAVAILABLE_MESSAGE}`
      : undefined;
  if (mustVerify) {
    return unavailable
      ? { checkEmail: parsed.data.email, error: unavailable }
      : { checkEmail: parsed.data.email };
  }
  return { error: unavailable ?? "Could not sign you in. Try signing in with your new password." };
}
