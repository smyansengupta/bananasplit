import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/lib/auth/session";
import { peekVerificationToken } from "@/server/email/verification";

import { confirmEmailAction, resendVerificationAction } from "./actions";

/**
 * The link in the sign-up confirmation email. Opening it only shows a
 * "Confirm email" button; the token is consumed by the button's POST, so a
 * mail scanner that prefetches links cannot use it up.
 */
export const dynamic = "force-dynamic";

const RESULTS = {
  ok: {
    title: "Email confirmed",
    description: "Thanks. Your email address is confirmed.",
  },
  expired: {
    title: "This link has expired",
    description: "Confirmation links last 24 hours. Sign in and ask for a new one below.",
  },
  invalid: {
    title: "This link doesn't work",
    description: "It may have been used already. If your email isn't confirmed yet, ask for a new link.",
  },
  resent: {
    title: "Check your inbox",
    description: "We sent a new confirmation link. It may take a minute to arrive.",
  },
  limited: {
    title: "Too many requests",
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
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {children && <CardContent className="space-y-3">{children}</CardContent>}
      </Card>
    </div>
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
    <Button asChild className="w-full">
      <Link href={session ? "/app" : "/sign-in"}>{session ? "Continue" : "Sign in"}</Link>
    </Button>
  );
  const resendButton = session ? (
    <form action={resendVerificationAction.bind(null, token)}>
      <Button type="submit" variant="outline" className="w-full">
        Send a new link
      </Button>
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

  return (
    <Shell
      title="Confirm your email"
      description="Confirm this address to finish setting up your Clubport account."
    >
      <form action={confirmEmailAction.bind(null, token)}>
        <Button type="submit" className="w-full">
          Confirm email
        </Button>
      </form>
    </Shell>
  );
}
