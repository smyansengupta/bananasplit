"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { safeCallbackUrl } from "@/lib/auth/callback-url";
import { credentialsSignIn, SIGN_IN_UNAVAILABLE_MESSAGE } from "@/lib/auth/credentials-sign-in";
import { emailVerificationRequired } from "@/lib/auth/email-verification";
import { hashPassword } from "@/lib/auth/password";
import { newPasswordSchema } from "@/lib/auth/password-policy";
import { onboardingHref } from "@/lib/onboarding/steps";
import { checkRateLimit, rateLimitKey, retryAfterText } from "@/lib/rate-limit";
import { signUpPerIpLimit } from "@/lib/auth/ip-limits";
import { getClientIp } from "@/lib/request-ip";
import { FUNNEL_EVENTS } from "@/lib/analytics/events";
import { trackServer } from "@/lib/analytics/server";
import { authDb } from "@/server/db/clients";
import { enqueueVerificationEmail } from "@/server/email/verification";

/**
 * Sign-up limits: per client IP (sized for a room on one network; see
 * src/lib/auth/ip-limits.ts) and per normalized email (Postgres-backed).
 */
const SIGN_UP_LIMITS = {
  perIp: { windowSec: 60 * 60 },
  perEmail: { limit: 3, windowSec: 60 * 60 },
} as const;

const signUpSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  // Stored as lower(btrim()), like every email (0a_normalize_emails).
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  password: newPasswordSchema,
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
 * and lands on "Your profile", which shows the 'check your email' state. An
 * unverified account can sign in but cannot create or join an organization
 * (Fix 4(c)), and an abandoned one is purged after 72 hours.
 */
export async function signUpAction(
  prevState: SignUpState,
  formData: FormData,
): Promise<SignUpState> {
  try {
    return await createAccount(prevState, formData);
  } catch (error) {
    // The redirect into onboarding is thrown; let it through.
    unstable_rethrow(error);
    // Anything else (the database out of reach, say) is a message on the
    // form, never an uncaught error. This is before the account exists;
    // afterAccountCreated has its own message for failures after.
    console.error("[sign-up] failed", error instanceof Error ? error.message : error);
    return { error: "We couldn't create your account just now. Try again in a minute." };
  }
}

async function createAccount(_prevState: SignUpState, formData: FormData): Promise<SignUpState> {
  const parsed = signUpSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  if (formData.get("confirmPassword") !== parsed.data.password) {
    return { error: "The passwords don't match." };
  }

  const ip = await getClientIp();
  const [byIp, byEmail] = await Promise.all([
    checkRateLimit(
      rateLimitKey("signup-ip", ip),
      signUpPerIpLimit(),
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

  try {
    return await afterAccountCreated(user.id, parsed.data, mustVerify, formData);
  } catch (error) {
    // The redirect into onboarding is thrown; let it through.
    unstable_rethrow(error);
    // The account exists now, so never "couldn't create": say so, and
    // offer the way in (a retry would only hit "already exists").
    console.error(
      "[sign-up] failed after the account was made",
      error instanceof Error ? error.message : error,
    );
    const created = `Your account was created, but we couldn't sign you in. ${SIGN_IN_UNAVAILABLE_MESSAGE}`;
    return mustVerify ? { checkEmail: parsed.data.email, error: created } : { error: created };
  }
}

/** Everything after the account row exists: the funnel event, the verification email, signing in. */
async function afterAccountCreated(
  userId: string,
  account: { email: string; password: string },
  mustVerify: boolean,
  formData: FormData,
): Promise<SignUpState> {
  await trackServer(FUNNEL_EVENTS.signedUp, { method: "email" });

  // The confirmation link goes out through the outbox (a verify-email
  // platform job, sent right after this request). An account that is never
  // confirmed, and never joins an org, is removed after 72 hours.
  // If queueing fails the account exists either way; onboarding offers
  // "Resend verification email".
  if (mustVerify) {
    try {
      await enqueueVerificationEmail(userId);
    } catch (error) {
      console.error(
        "[sign-up] could not queue the verification email",
        error instanceof Error ? error.message : error,
      );
    }
  }

  // On to "Your profile"; someone sent here from a specific page (an invite
  // link, a poll, "Start a club") goes back there after its first step.
  const next = onboardingHref(safeCallbackUrl(formData.get("callbackUrl")));
  const signedIn = await credentialsSignIn(account.email, account.password, next);
  if (signedIn.ok) redirect(next);

  // The account exists either way. A server-side failure is said as such
  // (it is not the password); anything else falls back to signing in by hand.
  const unavailable =
    signedIn.reason === "unavailable"
      ? `Your account was created, but we couldn't sign you in. ${SIGN_IN_UNAVAILABLE_MESSAGE}`
      : undefined;
  if (mustVerify) {
    return unavailable
      ? { checkEmail: account.email, error: unavailable }
      : { checkEmail: account.email };
  }
  return { error: unavailable ?? "Could not sign you in. Try signing in with your new password." };
}
