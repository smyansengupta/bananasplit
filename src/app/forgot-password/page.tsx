import type { Metadata } from "next";
import { AuthCard } from "@/components/brand/auth-card";
import { googleSignInEnabled } from "@/lib/auth/google-sign-in";
import { PASSWORD_RESET_TTL_MINUTES } from "@/server/email/password-reset";
import { mainShare } from "@/lib/metadata/share";

import { ForgotPasswordForm } from "./forgot-password-form";

// The main card, src/app/opengraph-image.png.
export const metadata: Metadata = {
  ...mainShare({
    title: "Reset your password",
    description: "We'll email you a link to set a new password.",
  }),
};

/** Where the log-in form's "Forgot?" goes: ask for an emailed reset link. */
export default function ForgotPasswordPage() {
  return (
    <AuthCard>
      <ForgotPasswordForm
        expiresMinutes={PASSWORD_RESET_TTL_MINUTES}
        googleEnabled={googleSignInEnabled()}
      />
    </AuthCard>
  );
}
