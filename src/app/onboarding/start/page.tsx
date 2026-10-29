import { redirect } from "next/navigation";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { requireUser } from "@/lib/auth/session";
import { getOnboardingProfile } from "@/server/onboarding/profile";
import { findPendingInvitationsForMe } from "@/server/settings/invitations";

import { StartScreen } from "./start-screen";

export const metadata = { title: "Get started · Bananasplit" };

/**
 * "What are you here for?": the one question after sign-up. Join an
 * organization with its code, create one (on its free trial of Team
 * Advanced), or just yourself (the Personal space, set up in five quick
 * steps). Email invites waiting for this address come first: one click and
 * they're in, the shortest way of all.
 */
export default async function StartPage() {
  const user = await requireUser();
  const profile = await getOnboardingProfile(user.id);
  if (!profile) redirect("/auth/session-ended");
  if (!profile.onboardedAt) redirect("/onboarding");
  const invites = profile.emailVerified ? await findPendingInvitationsForMe(user.id) : [];
  const first = profile.name?.trim().split(/\s+/)[0];

  return (
    <StartScreen
      first={first}
      invites={invites}
      exit={
        <SignOutButton className="text-muted-foreground hover:text-foreground h-auto p-0 text-[14px] font-semibold hover:bg-transparent" />
      }
    />
  );
}
