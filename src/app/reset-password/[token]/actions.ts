"use server";

import { redirect } from "next/navigation";

import { newPasswordSchema } from "@/lib/auth/password-policy";
import { checkRateLimit, rateLimitKey, retryAfterText } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { enqueuePasswordChangedEmail, resetPassword } from "@/server/email/password-reset";

/**
 * The reset form's POST: the only place a reset link is spent. Limited per
 * client IP; the new password follows the same rules as sign-up. On success
 * every session has ended (the session version moved on), the owner gets a
 * "password changed" email, and they log in again with the new password.
 */
const SUBMIT_LIMIT = { limit: 30, windowSec: 15 * 60 } as const;

export interface ResetPasswordState {
  error?: string;
  /** The link can't be used any more: offer a new one instead of the form. */
  linkDead?: boolean;
}

export async function resetPasswordAction(
  token: string,
  _prevState: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const ip = await getClientIp();
  const limit = await checkRateLimit(
    rateLimitKey("pwreset-submit-ip", ip),
    SUBMIT_LIMIT.limit,
    SUBMIT_LIMIT.windowSec,
    { via: "auth" },
  );
  if (!limit.allowed) return { error: `Too many tries. Try again ${retryAfterText(limit)}.` };

  const parsed = newPasswordSchema.safeParse(formData.get("password"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Choose a different password." };
  }
  if (formData.get("confirmPassword") !== parsed.data) {
    return { error: "The passwords don't match." };
  }

  const result = await resetPassword(typeof token === "string" ? token : "", parsed.data);
  if (!result.ok) {
    return {
      linkDead: true,
      error:
        result.reason === "expired"
          ? "This link has expired. Ask for a new one."
          : "This link doesn't work any more. Ask for a new one.",
    };
  }

  try {
    await enqueuePasswordChangedEmail(result.userId);
  } catch (error) {
    console.error(
      "[password-reset] could not queue the password-changed email",
      error instanceof Error ? error.message : error,
    );
  }
  redirect("/sign-in?notice=password-reset");
}
