"use server";

import { redirect } from "next/navigation";

import {
  consumeEmailVerification,
  getUserIdentity,
  issueEmailVerification,
  sendVerificationEmail,
} from "@/lib/auth/email-verification";
import { getSession, requireUser } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/rate-limit";

const RESEND_LIMIT = 3;
const RESEND_WINDOW_MS = 15 * 60 * 1000;

export interface ConfirmEmailState {
  error?: string;
  /** Verified, but nobody is signed in on this browser. */
  verified?: boolean;
}

/**
 * Consumes a verification token (0A Fix 4(b)). A POST from a button on the
 * /verify-email/[token] page, never the GET itself, so a mail scanner that
 * prefetches links (Microsoft 365 Safe Links, for example) cannot burn the
 * token. Possession of the emailed token proves control of the address.
 */
export async function confirmEmailAction(
  token: string,
  _prev: ConfirmEmailState,
): Promise<ConfirmEmailState> {
  const result = await consumeEmailVerification(token);
  if (!result.ok) {
    return {
      error:
        result.reason === "expired"
          ? "This link has expired. Sign in and send yourself a new one."
          : "This link is invalid or was already used. Sign in and send yourself a new one if you still need to verify.",
    };
  }
  const session = await getSession();
  if (session) redirect("/app");
  return { verified: true };
}

export interface ResendState {
  error?: string;
  sent?: boolean;
}

/** Sends the signed-in, unverified user a fresh link (rate-limited). */
export async function resendVerificationEmailAction(_prev: ResendState): Promise<ResendState> {
  const user = await requireUser();
  const identity = await getUserIdentity(user.id);
  if (!identity) return { error: "Account not found." };
  if (identity.emailVerified) return { sent: false };

  const limit = checkRateLimit(`verify-resend:${user.id}`, RESEND_LIMIT, RESEND_WINDOW_MS);
  if (!limit.allowed) {
    return { error: "Too many verification emails requested. Try again in a few minutes." };
  }

  const token = await issueEmailVerification(identity.email);
  await sendVerificationEmail(identity.email, token);
  return { sent: true };
}
