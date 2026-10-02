import { Building2, KeyRound, Mail } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { VerifyEmailNotice } from "@/components/auth/verify-email-notice";
import {
  ChoiceTileBody,
  choiceTileClass,
  OnboardingFrame,
  StepCard,
} from "@/components/onboarding/step-card";
import { requireUser } from "@/lib/auth/session";
import { withUserTx } from "@/server/db/context";
import { getOnboardingProfile } from "@/server/onboarding/profile";
import { findPendingInvitationsForMe } from "@/server/settings/invitations";

import { PendingInviteCard } from "./pending-invite-card";

/**
 * /onboarding: where sign-up and sign-in land for someone with no org.
 *
 * The flowchart's first decision, "Profile complete?": no -> profile setup
 * (A1). Yes, with an org -> that org's home. Yes, without one -> A7: join
 * with an invite code or an emailed invite, or create an organization.
 */
export default async function OnboardingPage() {
  const user = await requireUser();
  const profile = await getOnboardingProfile(user.id);
  if (!profile) redirect("/auth/session-ended");
  if (!profile.onboardedAt) redirect("/onboarding/profile/basics");
  if (profile.memberships[0]) redirect(`/app/${profile.memberships[0].slug}`);

  // Orgs scheduled for deletion stay reachable at their URL, where an owner
  // can cancel during the 30-day grace period.
  const pendingDeletion = await withUserTx(user.id, ({ db }) =>
    db.membership.findMany({
      where: { userId: user.id, organization: { deletedAt: { not: null } } },
      select: { organization: { select: { name: true, slug: true, deleteScheduledFor: true } } },
    }),
  );
  // Pending invites are listed only for a verified address (0A Fix 4).
  const pendingInvites = profile.emailVerified ? await findPendingInvitationsForMe(user.id) : [];

  return (
    <OnboardingFrame>
      <StepCard
        title={`Welcome${profile.name ? `, ${profile.name.split(" ")[0]}` : ""}`}
        description="Your profile is set. Now find your club, or start one."
      >
        {!profile.emailVerified && (
          <VerifyEmailNotice email={profile.email} action="create an organization or join one" />
        )}

        {pendingInvites.length > 0 && (
          <section className="space-y-2">
            <h2 className="flex items-center gap-1.5 text-sm font-medium">
              <Mail className="text-muted-foreground size-3.5" aria-hidden="true" />
              Email invites for {profile.email}
            </h2>
            {pendingInvites.map((invitation) => (
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

        {profile.emailVerified && (
          <div className="grid gap-2">
            <Link href="/onboarding/join" className={choiceTileClass}>
              <ChoiceTileBody
                icon={KeyRound}
                primary
                title="Join with invite code"
                detail="Your club's admin shared a code or a link."
              />
            </Link>
            <Link href="/onboarding/organization" className={choiceTileClass}>
              <ChoiceTileBody
                icon={Building2}
                title="Create an organization"
                detail="Start a new workspace for your club. You'll be its admin."
              />
            </Link>
          </div>
        )}

        {pendingDeletion.length > 0 && (
          <section className="space-y-2 border-t pt-3">
            <h2 className="text-xs font-medium">Scheduled for deletion</h2>
            <ul className="space-y-2">
              {pendingDeletion.map(({ organization: org }) => (
                <li
                  key={org.slug}
                  className="flex items-center justify-between rounded-md border p-3 text-sm"
                >
                  <span>
                    <span className="font-medium">{org.name}</span>
                    {org.deleteScheduledFor && (
                      <span className="text-muted-foreground">
                        {" "}
                        · deleted on{" "}
                        {org.deleteScheduledFor.toLocaleDateString("en-US", {
                          dateStyle: "medium",
                        })}
                      </span>
                    )}
                  </span>
                  <Link href={`/app/${org.slug}`} className="underline underline-offset-4">
                    Open
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="text-muted-foreground text-center text-xs">
          <Link href="/onboarding/profile/review" className="hover:underline">
            Review your profile
          </Link>
        </p>
      </StepCard>
    </OnboardingFrame>
  );
}
