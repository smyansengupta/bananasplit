"use server";

import { redirect } from "next/navigation";

import { safeCallbackUrl } from "@/lib/auth/callback-url";
import { credentialsSignIn, SIGN_IN_UNAVAILABLE_MESSAGE } from "@/lib/auth/credentials-sign-in";

export interface PasswordSignInState {
  error?: string;
}

const MESSAGES = {
  invalid: "Incorrect email or password.",
  rate_limited: "Too many sign-in attempts. Wait a few minutes and try again.",
  // A server-side failure (e.g. a missing AUTH_SECRET), never the user's
  // password: logged with its Auth.js type by credentialsSignIn.
  unavailable: SIGN_IN_UNAVAILABLE_MESSAGE,
} as const;

export async function passwordSignInAction(
  _prevState: PasswordSignInState,
  formData: FormData,
): Promise<PasswordSignInState> {
  const email = formData.get("email");
  const password = formData.get("password");
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return { error: "Enter your email and password." };
  }

  // Back to the page that sent them here (an email deep link), if it is a
  // same-origin relative path; otherwise the app home, which sends an
  // unverified account on to onboarding's "check your email" notice.
  const redirectTo = safeCallbackUrl(formData.get("callbackUrl")) ?? "/app";

  const result = await credentialsSignIn(email, password, redirectTo);
  if (!result.ok) return { error: MESSAGES[result.reason] };
  redirect(redirectTo);
}
