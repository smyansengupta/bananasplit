import Link from "next/link";
import { redirect } from "next/navigation";

import { ClubPreview } from "@/app/onboarding/join/club-preview";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { VerifyEmailNotice } from "@/components/auth/verify-email-notice";
import { Button } from "@/components/ui/button";
import { signInPath } from "@/lib/auth/callback-url";
import { getUserIdentity } from "@/lib/auth/email-verification";
import { googleSignInEnabled } from "@/lib/auth/google-sign-in";
import { sameEmail } from "@/lib/auth/normalize-email";
import { getSession } from "@/lib/auth/session";
import { orgLogoUrl } from "@/lib/org-logo";
import { getPublicOrgTheme } from "@/lib/theme/loader";
import { needsProfileSetup } from "@/server/onboarding/profile";
import { findInvitationByRawToken } from "@/server/settings/invitations";

import { JoinButton } from "./join-button";

/** "a member", "an admin", "an owner". */
function roleName(role: string): string {
  const name = role.toLowerCase();
  return /^[aeiou]/.test(name) ? `an ${name}` : `a ${name}`;
}

/** The invite's card (Moonstone): a display title, the line under it, then the actions. */
function InviteCard({
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
 * An emailed invite link: who's inviting you (the club, with its logo and
 * the role you'd join as), then Join, then the one small club step, "Your
 * role in <club>" (/onboarding/join/[orgSlug]). Signed out: sign in, or
 * create an account and come straight back here after the first profile
 * step. A joiner never sees a price or a trial.
 */
export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const here = `/invite/${token}`;

  const invitation = await findInvitationByRawToken(token);
  if (!invitation) {
    return <InviteCard title="Invite not found" description="This invite link isn't valid." />;
  }
  if (invitation.acceptedAt) {
    return <InviteCard title="Already used" description="This invite has already been accepted." />;
  }
  if (invitation.expiresAt < new Date()) {
    return <InviteCard title="Invite expired" description="Ask for a new invite to join." />;
  }

  const session = await getSession();
  const signUpHref = `/sign-up?callbackUrl=${encodeURIComponent(here)}`;

  if (!session) {
    return (
      <InviteCard
        title={`Join ${invitation.orgName}`}
        description={`Sign in as ${invitation.email} to accept this invite.`}
      >
        {googleSignInEnabled() ? (
          <>
            <GoogleSignInButton redirectTo={here} />
            <p className="text-muted-foreground mt-3 text-center text-sm leading-[1.5]">
              Or{" "}
              <Link
                href={signInPath(here)}
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
              </Link>{" "}
              with {invitation.email}. You&apos;ll come back here.
            </p>
          </>
        ) : (
          <>
            {/* Without a Google client configured, email and password only. */}
            <Button asChild className="w-full">
              <Link href={signInPath(here)}>Sign in</Link>
            </Button>
            <p className="text-muted-foreground mt-3 text-center text-sm leading-[1.5]">
              New here?{" "}
              <Link
                href={signUpHref}
                className="text-foreground font-medium underline underline-offset-4"
              >
                Create an account
              </Link>{" "}
              with {invitation.email}. You&apos;ll come back here.
            </p>
          </>
        )}
      </InviteCard>
    );
  }

  // Compare against the account's STORED address, and require it verified:
  // an invite can only be taken by whoever controls the invited mailbox
  // (0A Fix 4).
  const identity = await getUserIdentity(session.user.id);
  if (!identity || !sameEmail(identity.email, invitation.email)) {
    return (
      <InviteCard
        title="Wrong account"
        description={`This invite was sent to ${invitation.email}, but you're signed in as ${identity?.email ?? session.user.email}.`}
      />
    );
  }

  // "Your profile", step 1, comes first (it makes the account's Personal
  // space); it brings them straight back here.
  if (await needsProfileSetup(session.user.id)) {
    redirect(`/onboarding?callbackUrl=${encodeURIComponent(here)}`);
  }

  // The verified-address gate stays (0A Fix 4): an invite link can be
  // forwarded, so opening it doesn't prove the invited mailbox is yours.
  if (!identity.emailVerified) {
    return (
      <InviteCard
        title={`Join ${invitation.orgName}`}
        description="Verify your email address to accept this invite."
      >
        <VerifyEmailNotice email={identity.email} action="accept this invite" />
      </InviteCard>
    );
  }

  const club = await getPublicOrgTheme(invitation.organizationId);
  return (
    <InviteCard
      title={`Join ${invitation.orgName}`}
      description={`You're invited to join as ${roleName(invitation.role)}.`}
    >
      <div className="flex flex-col gap-4">
        <ClubPreview
          name={invitation.orgName}
          logoUrl={orgLogoUrl(club?.logo, 64)}
          detail={`Invite for ${invitation.email}`}
        />
        <JoinButton token={token} orgName={invitation.orgName} />
      </div>
    </InviteCard>
  );
}
