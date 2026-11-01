"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AFTER_VERIFY_COOKIE } from "@/lib/auth/after-verify";
import { safeCallbackUrl, signInPath } from "@/lib/auth/callback-url";
import { getSession } from "@/lib/auth/session";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { authDb } from "@/server/db/clients";
import { consumeVerificationToken, enqueueVerificationEmail } from "@/server/email/verification";

/** A fresh link at most 3 times an hour per account. */
const RESEND_LIMIT = { limit: 3, windowSec: 60 * 60 } as const;

function resultUrl(token: string, result: string): string {
  return `/verify-email/${encodeURIComponent(token)}?result=${result}`;
}

/**
 * Confirms the address behind `token` for the signed-in account (single
 * use). Confirmed, it goes straight back to whatever was waiting on it (a
 * join link, an invite, creating a club: the page that showed "Check your
 * email" remembered itself in AFTER_VERIFY_COOKIE), or into the app; no
 * "Email confirmed" stop in between. Otherwise it shows what went wrong.
 * Signed out, it asks for a log-in first and comes back here.
 */
export async function confirmEmailAction(token: string): Promise<void> {
  const session = await getSession();
  if (!session) redirect(signInPath(`/verify-email/${encodeURIComponent(token)}`));
  const outcome = await consumeVerificationToken(token, session.user.id);
  if (!outcome.ok) redirect(resultUrl(token, outcome.reason));
  const jar = await cookies();
  const raw = jar.get(AFTER_VERIFY_COOKIE)?.value ?? "";
  let remembered: string | null = raw;
  try {
    // Written encoded; read back as written whichever way the jar hands it over.
    remembered = raw.startsWith("%2F") ? decodeURIComponent(raw) : raw;
  } catch {
    remembered = null;
  }
  const after = safeCallbackUrl(remembered);
  jar.delete(AFTER_VERIFY_COOKIE);
  redirect(after ?? "/app");
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
