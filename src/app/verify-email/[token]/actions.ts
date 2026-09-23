"use server";

import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth/session";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { authDb } from "@/server/db/clients";
import { consumeVerificationToken, enqueueVerificationEmail } from "@/server/email/verification";

/** A fresh link at most 3 times an hour per account. */
const RESEND_LIMIT = { limit: 3, windowSec: 60 * 60 } as const;

function resultUrl(token: string, result: string): string {
  return `/verify-email/${encodeURIComponent(token)}?result=${result}`;
}

/** Confirms the address behind `token` (single use), then shows the outcome. */
export async function confirmEmailAction(token: string): Promise<void> {
  const outcome = await consumeVerificationToken(token);
  redirect(resultUrl(token, outcome.ok ? "ok" : outcome.reason));
}

/** Sends the signed-in user a new confirmation link. */
export async function resendVerificationAction(token: string): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/sign-in`);

  const user = await authDb.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, emailVerified: true },
  });
  if (!user) redirect(`/sign-in`);
  if (user.emailVerified) redirect(resultUrl(token, "ok"));

  const limited = await checkRateLimit(
    rateLimitKey("verify-resend", user.id),
    RESEND_LIMIT.limit,
    RESEND_LIMIT.windowSec,
    { via: "auth" },
  );
  if (!limited.allowed) redirect(resultUrl(token, "limited"));

  await enqueueVerificationEmail(user.id);
  redirect(resultUrl(token, "resent"));
}
