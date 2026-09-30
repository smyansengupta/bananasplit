import Link from "next/link";
import { redirect } from "next/navigation";

import { VerifyEmailNotice } from "@/components/auth/verify-email-notice";
import { OnboardingFrame, StepCard } from "@/components/onboarding/step-card";
import { requireUser } from "@/lib/auth/session";
import { getOnboardingProfile } from "@/server/onboarding/profile";
import { findPendingInvitationsForMe } from "@/server/settings/invitations";

import { PendingInviteCard } from "../pending-invite-card";
import { JoinForm } from "./join-form";

export const dynamic = "force-dynamic";

/**
 * A7 · Join: with the org's invite code, or with an invite emailed to the
 * member's verified address. Both are checked against the organization on
 * the server before anyone joins. ?code= pre-fills the code (the link an
 * admin shares).
 */
export default async function JoinPage({ searchParams }: PageProps<"/onboarding/join">) {
  const user = await requireUser();
  const profile = await getOnboardingProfile(user.id);
  if (!profile) redirect("/sign-in");
  const { code } = await searchParams;
  const initialCode = typeof code === "string" ? code.slice(0, 20) : "";
  // Profile setup comes first (the flowchart's "Profile complete?").
  if (!profile.onboardedAt) redirect("/onboarding/profile/basics");

  const invites = profile.emailVerified ? await findPendingInvitationsForMe(user.id) : [];

  return (
    <OnboardingFrame>
      <StepCard
        label="A7 · Join"
        title="Join your organization"
        description="Enter the invite code an admin shared with you. We check it with the organization before you join."
      >
        {profile.emailVerified ? (
          <JoinForm initialCode={initialCode} email={profile.email} />
        ) : (
          <VerifyEmailNotice email={profile.email} action="join an organization" />
        )}

        {invites.length > 0 && (
          <section className="space-y-2 border-t pt-3">
            <h2 className="text-xs font-medium">Or accept an email invite to {profile.email}</h2>
            {invites.map((invitation) => (
              <PendingInviteCard
                key={invitation.id}
                invitation={{
                  id: invitation.id,
                  role: invitation.role,
                  orgName: invitation.orgName,
                }}
              />
            ))}
          </section>
        )}

        <div className="text-muted-foreground flex justify-between border-t pt-3 text-xs">
          <Link href="/onboarding" className="hover:underline">
            Back
          </Link>
          <Link href="/onboarding/organization" className="hover:underline">
            Create an organization instead
          </Link>
        </div>
      </StepCard>
    </OnboardingFrame>
  );
}
