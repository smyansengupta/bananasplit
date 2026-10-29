import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard, AuthTitle } from "@/components/brand/auth-card";
import { pill } from "@/components/brand/pill";
import { cn } from "@/lib/utils";
import { peekPasswordResetToken } from "@/server/email/password-reset";

import { resetPasswordAction } from "./actions";
import { ResetPasswordForm } from "./reset-password-form";

export const dynamic = "force-dynamic";

/** The token is in the URL: never pass it on to another site as a referrer. */
export const metadata: Metadata = {
  title: "Set a new password · Bananasplit",
  referrer: "no-referrer",
};

const DEAD = {
  expired: {
    title: "This link has expired.",
    description:
      "Reset links work for an hour. Ask for a new one and use it soon after it arrives.",
  },
  invalid: {
    title: "This link doesn't work.",
    description: "It may have been used already, or a newer link replaced it. Ask for a new one.",
  },
} as const;

/**
 * The link in the reset email. Opening it only checks the token; the form's
 * POST spends it, so a mail scanner that opens links can't use it up.
 */
export default async function ResetPasswordPage({ params }: PageProps<"/reset-password/[token]">) {
  const { token } = await params;
  const state = await peekPasswordResetToken(token);

  if (state !== "valid") {
    const copy = DEAD[state];
    return (
      <AuthCard>
        <AuthTitle title={copy.title} description={copy.description} />
        <Link href="/forgot-password" className={cn(pill(), "w-full")}>
          Send a new link
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <AuthTitle title="Choose a new password." description="At least 8 characters." />
      <ResetPasswordForm action={resetPasswordAction.bind(null, token)} />
    </AuthCard>
  );
}
