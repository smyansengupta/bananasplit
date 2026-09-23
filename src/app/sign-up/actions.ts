"use server";

import { AuthError } from "next-auth";
import { z } from "zod";

import { signIn } from "@/lib/auth/config";
import { issueEmailVerification, sendVerificationEmail } from "@/lib/auth/email-verification";
import { hashPassword } from "@/lib/auth/password";
import { authDb } from "@/server/db/clients";

const signUpSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  // Stored as lower(btrim()), like every email (0a_normalize_emails).
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
});

export interface SignUpState {
  error?: string;
  /** The account exists and a verification link was sent to this address. */
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
  await authDb.user.create({
    data: {
      email: parsed.data.email,
      name: parsed.data.name,
      credential: { create: { passwordHash } },
    },
  });

  try {
    const token = await issueEmailVerification(parsed.data.email);
    await sendVerificationEmail(parsed.data.email, token);
  } catch (error) {
    // The account exists either way; onboarding offers "Resend link".
    console.error("[sign-up] could not send the verification email", error);
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/onboarding",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { checkEmail: parsed.data.email };
    }
    throw error;
  }
  return { checkEmail: parsed.data.email };
}
