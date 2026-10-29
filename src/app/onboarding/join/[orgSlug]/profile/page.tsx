import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ProfileForm } from "@/app/onboarding/profile/profile-form";
import { exitClass, SetupShell } from "@/components/onboarding/setup-shell";
import { requireUser } from "@/lib/auth/session";
import { START_HREF } from "@/lib/onboarding/steps";
import { getJoinedClub } from "@/server/onboarding/club-role";
import { getOnboardingProfile } from "@/server/onboarding/profile";

export const dynamic = "force-dynamic";

export const metadata = { title: "Your profile · Bananasplit" };

/**
 * Your profile in an organization you just joined (a code, a link or an
 * emailed invite), on one screen: picture, name, pronouns, time zone, bio
 * and links. Then in.
 */
export default async function JoinedProfilePage({
  params,
}: PageProps<"/onboarding/join/[orgSlug]/profile">) {
  const { orgSlug } = await params;
  const user = await requireUser();
  const [profile, club] = await Promise.all([
    getOnboardingProfile(user.id),
    getJoinedClub(user.id, orgSlug),
  ]);
  if (!profile) redirect("/auth/session-ended");
  if (!club) notFound();
  const home = `/app/${club.slug}`;

  return (
    <SetupShell
      subject={`you in ${club.name}`}
      exit={
        <Link href={home} className={exitClass}>
          Finish later
        </Link>
      }
    >
      <ProfileForm
        title={`You're in ${club.name}.`}
        intro={"How they'll see you."}
        user={{
          name: profile.name,
          email: profile.email,
          image: profile.image,
          avatar: profile.avatar,
        }}
        initial={{
          name: profile.name ?? "",
          pronouns: profile.pronouns ?? "",
          timezone: profile.timezone,
          bio: profile.bio,
          links: profile.links,
        }}
        next={home}
        back={START_HREF}
        continueLabel={`Go to ${club.name}`}
      />
    </SetupShell>
  );
}
