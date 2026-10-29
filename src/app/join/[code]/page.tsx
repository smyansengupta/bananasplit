import Link from "next/link";

import { ClubPreview } from "@/app/onboarding/join/club-preview";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { Button } from "@/components/ui/button";
import { signInPath } from "@/lib/auth/callback-url";
import { googleSignInEnabled } from "@/lib/auth/google-sign-in";
import { getSession } from "@/lib/auth/session";
import { orgLogoUrl } from "@/lib/org-logo";

import { clubForCode } from "./club";

/** The card, as the emailed invite draws it: a display title, a line, then the actions. */
function JoinCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10 sm:p-6">
      <div className="bg-card text-card-foreground edge ring-foreground/6 rounded-card flex w-full max-w-md flex-col gap-6 p-6 ring-1 sm:p-8">
        <div className="flex flex-col gap-2">
          <h1 className="display-title m-0 text-[30px] tracking-[-0.03em]">{title}</h1>
          <p className="text-muted-foreground m-0 text-[15px] leading-[1.55]">{description}</p>
        </div>
        {children}
      </div>
    </main>
  );
}

/**
 * /join/<code>: the link an officer texts (Settings > Members, the club's
 * dashboard, onboarding's invite step). Anyone with the link sees which club
 * it opens, its name and logo, before signing in; then Continue takes them
 * into the real join, /onboarding/join?code=, which checks everything again
 * for a verified account (the allowed domain, the member cap) and asks for
 * an account first when there isn't one. Joining is always free.
 */
export default async function JoinCodePage({ params }: PageProps<"/join/[code]">) {
  const { code: raw } = await params;
  const club = await clubForCode(raw);

  if (!club) {
    return (
      <JoinCard
        title="Invite code not found"
        description="This code isn't working. Check it with whoever sent it, or type it in."
      >
        <Button asChild className="w-full">
          <Link href="/onboarding/join">Enter a code</Link>
        </Button>
      </JoinCard>
    );
  }

  const next = `/onboarding/join?code=${encodeURIComponent(club.code)}`;
  const signedIn = Boolean(await getSession());
  const signUpHref = `/sign-up?callbackUrl=${encodeURIComponent(next)}`;

  return (
    <JoinCard
      title={`Join ${club.name}`}
      description={`You've been invited to join ${club.name} on Bananasplit.`}
    >
      <div className="flex flex-col gap-4">
        <ClubPreview
          name={club.name}
          logoUrl={orgLogoUrl(club.logo, 64)}
          detail={`Invite code ${club.code}`}
        />
        {signedIn ? (
          <Button asChild className="w-full">
            <Link href={next}>Continue</Link>
          </Button>
        ) : googleSignInEnabled() ? (
          <div>
            <GoogleSignInButton redirectTo={next} />
            <p className="text-muted-foreground mt-3 text-center text-sm leading-[1.5]">
              Or{" "}
              <Link
                href={signInPath(next)}
                className="text-foreground font-medium underline underline-offset-4"
              >
                sign in
              </Link>{" "}
              or{" "}
              <Link
                href={signUpHref}
                className="text-foreground font-medium underline underline-offset-4"
              >
                create an account
              </Link>
              . You&apos;ll come straight back to join.
            </p>
          </div>
        ) : (
          <div>
            <Button asChild className="w-full">
              <Link href={signUpHref}>Create an account</Link>
            </Button>
            <p className="text-muted-foreground mt-3 text-center text-sm leading-[1.5]">
              Already on Bananasplit?{" "}
              <Link
                href={signInPath(next)}
                className="text-foreground font-medium underline underline-offset-4"
              >
                Sign in
              </Link>
              . You&apos;ll come straight back to join.
            </p>
          </div>
        )}
      </div>
    </JoinCard>
  );
}
