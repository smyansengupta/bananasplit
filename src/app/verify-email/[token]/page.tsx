import type { Metadata } from "next";
import Link from "next/link";

import { SignedInAs } from "@/components/auth/signed-in-as";
import { AuthCard, AuthTitle } from "@/components/brand/auth-card";
import { pill } from "@/components/brand/pill";
import { signInPath } from "@/lib/auth/callback-url";
import { getSession } from "@/lib/auth/session";
import { cn } from "@/lib/utils";
import { peekVerificationToken } from "@/server/email/verification";
import { mainShare } from "@/lib/metadata/share";

import { confirmEmailAction, resendVerificationAction } from "./actions";

/**
 * The link in the sign-up confirmation email. Opening it only shows a
 * "Confirm email" button; the token is consumed by the button's POST, so a
 * mail scanner that prefetches links cannot use it up.
 */
export const dynamic = "force-dynamic";

/** The token is in the URL: never pass it on to another site as a referrer. */
// The main card, src/app/opengraph-image.png. The token is in the path, never the preview.
export const metadata: Metadata = {
  ...mainShare({
    title: "Confirm your email",
    description: "One tap and your Bananasplit account is ready.",
    noIndex: true,
  }),
  referrer: "no-referrer",
};

const RESULTS = {
  ok: {
    title: "Email confirmed.",
    description: "Thanks. Your email address is confirmed.",
  },
  expired: {
    title: "This link has expired.",
    description: "Confirmation links last 24 hours. Log in and ask for a new one below.",
  },
  invalid: {
    title: "This link doesn't work.",
    description:
      "It may have been used already. If your email isn't confirmed yet, ask for a new link.",
  },
  resent: {
    title: "Check your inbox.",
    description: "We sent a new confirmation link. It may take a minute to arrive.",
  },
  "wrong-account": {
    title: "This link is for another account.",
    description:
      "You're logged in as someone else. Log out, then log in with the account you signed up with and open the link again.",
  },
  limited: {
    title: "Too many requests.",
    description: "You've asked for several links recently. Try again in an hour.",
  },
} as const;

type Result = keyof typeof RESULTS;

function isResult(value: unknown): value is Result {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(RESULTS, value);
}

function Shell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <AuthCard footer={<SignedInAs />}>
      <AuthTitle title={title} description={description} />
      {children}
    </AuthCard>
  );
}

export default async function VerifyEmailPage({
  params,
  searchParams,
}: PageProps<"/verify-email/[token]">) {
  const { token } = await params;
  const { result } = await searchParams;
  const session = await getSession();

  const continueLink = (
    <Link href={session ? "/app" : "/sign-in"} className={cn(pill(), "w-full")}>
      {session ? "Continue" : "Log in"}
    </Link>
  );
  const resendButton = session ? (
    <form action={resendVerificationAction.bind(null, token)}>
      <button type="submit" className={cn(pill({ tone: "outline", size: "field" }), "w-full")}>
        Send a new link
      </button>
    </form>
  ) : null;

  if (isResult(result)) {
    const copy = RESULTS[result];
    return (
      <Shell title={copy.title} description={copy.description}>
        {(result === "expired" || result === "invalid") && resendButton}
        {continueLink}
      </Shell>
    );
  }

  const state = await peekVerificationToken(token);
  if (state !== "valid") {
    const copy = RESULTS[state];
    return (
      <Shell title={copy.title} description={copy.description}>
        {resendButton}
        {continueLink}
      </Shell>
    );
  }

  // The link only confirms for the account it was sent to: signed out, log
  // in first (and come back here).
  if (!session) {
    return (
      <Shell
        title="Log in to confirm."
        description="Log in with the account you signed up with, and you'll come straight back here to confirm your email."
      >
        <Link
          href={signInPath(`/verify-email/${encodeURIComponent(token)}`)}
          className={cn(pill(), "w-full")}
        >
          Log in
        </Link>
      </Shell>
    );
  }

  return (
    <Shell
      title="Confirm your email."
      description="Confirm this address to finish setting up your Bananasplit account."
    >
      <form action={confirmEmailAction.bind(null, token)}>
        <button type="submit" className={cn(pill(), "w-full")}>
          Confirm email
        </button>
      </form>
    </Shell>
  );
}
