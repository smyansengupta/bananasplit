import { redirect } from "next/navigation";

import { SignedInAs } from "@/components/auth/signed-in-as";
import { VerifyEmailNotice } from "@/components/auth/verify-email-notice";
import { ArrowRight } from "@/components/brand/arrows";
import { AuthCard, AuthTitle } from "@/components/brand/auth-card";
import { requireUser } from "@/lib/auth/session";
import { shareMetadata } from "@/lib/metadata/share";
import { getOnboardingProfile } from "@/server/onboarding/profile";
import { findPendingInvitationsForMe } from "@/server/settings/invitations";

import { PendingInviteCard } from "../pending-invite-card";
import { JoinForm } from "./join-form";

export const dynamic = "force-dynamic";

/*
 * The link an officer shares is /onboarding/join?code=XXXX-XXXX, so this is
 * what that message previews as, with the drawn card beside this file. It
 * cannot name the club: the page is behind sign-in, so whatever unfurls the
 * link is redirected away before it sees any of this, and the code alone is
 * not something a signed-out caller may trade for a club's name.
 */
export const metadata = shareMetadata({
  title: "Join your club",
  description: "Enter the invite code whoever invited you sent, and join their workspace.",
  noIndex: true,
});

const WHERE = [
  "Check the invite email from your organization.",
  "Or ask any admin. It's on their organization settings page.",
] as const;

/**
 * Join a club (design: App screens, 03): the club's code in eight boxes, or
 * an invite emailed to the member's verified address. Both are checked
 * against the club on the server, and the club is previewed (name, logo,
 * members) before anyone joins; then "Your role in <club>"
 * (./[orgSlug]). ?code= pre-fills the boxes (the link an officer shares).
 * Joining is always free: no prices or trials here.
 */
export default async function JoinPage({ searchParams }: PageProps<"/onboarding/join">) {
  const user = await requireUser();
  const profile = await getOnboardingProfile(user.id);
  if (!profile) redirect("/auth/session-ended");
  const { code } = await searchParams;
  const initialCode = typeof code === "string" ? code.slice(0, 20) : "";
  // A brand-new account is readied by /onboarding first; it brings them back here.
  if (!profile.onboardedAt) {
    const back = initialCode
      ? `/onboarding/join?code=${encodeURIComponent(initialCode)}`
      : "/onboarding/join";
    redirect(`/onboarding?callbackUrl=${encodeURIComponent(back)}`);
  }

  const invites = profile.emailVerified ? await findPendingInvitationsForMe(user.id) : [];

  return (
    <AuthCard
      footer={<SignedInAs />}
      formClassName="gap-6"
      panel={
        <div className="flex flex-col gap-5">
          <p className="font-heading m-0 text-[46px] leading-[1.02] tracking-[-0.035em]">
            Where&apos;s my code?
          </p>
          <ul className="m-0 flex list-none flex-col gap-3 p-0 text-[15px] leading-[1.45]">
            {WHERE.map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <ArrowRight className="mt-[3px]" />
                <span>{line}</span>
              </li>
            ))}
            <li className="flex items-start gap-2.5">
              <ArrowRight className="mt-[3px]" />
              <span>
                Codes are 8 letters and numbers, like <b>RPKA-YWSF</b>.
              </span>
            </li>
          </ul>
        </div>
      }
    >
      <AuthTitle title="Enter your invite code." />
      {profile.emailVerified ? (
        <JoinForm initialCode={initialCode} />
      ) : (
        <VerifyEmailNotice email={profile.email} action="join an organization" />
      )}

      {invites.length > 0 && (
        <section className="border-foreground/10 flex flex-col gap-2 border-t pt-4">
          <h2 className="m-0 text-[14px] font-semibold">
            Or accept an email invite to {profile.email}
          </h2>
          {invites.map((invitation) => (
            <PendingInviteCard key={invitation.id} invitation={invitation} />
          ))}
        </section>
      )}
    </AuthCard>
  );
}
