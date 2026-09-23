"use server";

import { AuthError, CredentialsSignin } from "next-auth";

import { signIn } from "@/lib/auth/config";

export interface PasswordSignInState {
  error?: string;
}

export async function passwordSignInAction(
  _prevState: PasswordSignInState,
  formData: FormData,
): Promise<PasswordSignInState> {
  const email = formData.get("email");
  const password = formData.get("password");
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return { error: "Enter your email and password." };
  }

  try {
    await signIn("credentials", { email, password, redirectTo: "/app" });
  } catch (error) {
    if (error instanceof CredentialsSignin && error.code === "rate_limited") {
      return { error: "Too many sign-in attempts. Wait a few minutes and try again." };
    }
    if (error instanceof AuthError) {
      return { error: "Incorrect email or password." };
    }
    throw error;
  }
  return {};
}
