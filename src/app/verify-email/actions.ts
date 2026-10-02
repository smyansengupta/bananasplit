"use server";

import { getUserIdentity } from "@/lib/auth/email-verification";
import { requireUser } from "@/lib/auth/session";
import { checkRateLimit, rateLimitKey, retryAfterText } from "@/lib/rate-limit";
import { enqueueVerificationEmail } from "@/server/email/verification";

/**
 * The same limit as the resend button on /verify-email/[token]: the two
 * share one bucket per account.
 */
const RESEND_LIMIT = { limit: 3, windowSec: 60 * 60 } as const;

export interface ResendState {
  error?: string;
  sent?: boolean;
  /** Already verified (e.g. in another tab): nothing was sent. */
  verified?: boolean;
}

/**
 * Sends the signed-in, unverified user a fresh link (0A Fix 4(b)), from the
 * 'check your email' notice on onboarding and the invite page. The link is
 * minted and mailed by a verify-email job (the outbox), sent right after
 * this request.
 */
export async function resendVerificationEmailAction(_prev: ResendState): Promise<ResendState> {
  const user = await requireUser();
  const identity = await getUserIdentity(user.id);
  if (!identity) return { error: "Account not found." };
  if (identity.emailVerified) return { verified: true };

  const limited = await checkRateLimit(
    rateLimitKey("verify-resend", user.id),
    RESEND_LIMIT.limit,
    RESEND_LIMIT.windowSec,
    { via: "auth" },
  );
  if (!limited.allowed) {
    return {
      error: `Too many verification emails requested. Try again ${retryAfterText(limited)}.`,
    };
  }

  try {
    await enqueueVerificationEmail(user.id);
  } catch (error) {
    console.error(
      "[verify-email] could not queue the verification email",
      error instanceof Error ? error.message : error,
    );
    return { error: "We couldn't send a new link right now. Try again in a few minutes." };
  }
  return { sent: true };
}
