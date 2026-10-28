import { CalendarX } from "@/components/icons";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { SignedInAs } from "@/components/auth/signed-in-as";
import { AuthCard, AuthHeadline, AuthTitle } from "@/components/brand/auth-card";
import { requireUser } from "@/lib/auth/session";
import { profileStepHref } from "@/lib/onboarding/steps";
import { orgLogoUrl } from "@/lib/org-logo";
import { getJoinedClub } from "@/server/onboarding/club-role";

import { ClubPreview } from "../club-preview";
import { RoleForm } from "./role-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Your role · Bananasplit" };

/**
 * "Your role in <club>": the one small club step after joining a club
 * (a code, an invite link or an emailed invite). The role is this club's
 * title on the membership; availability is the member's own, shared as
 * busy hours only. Then into the club. Skippable; a joiner never sees a
 * price or a trial here.
 */
export default async function ClubRolePage({ params }: PageProps<"/onboarding/join/[orgSlug]">) {
  const { orgSlug } = await params;
  const user = await requireUser();
  const club = await getJoinedClub(user.id, orgSlug);
  if (!club) notFound();
  // Past the join window the title is the admins' to set: straight in.
  if (!club.canSetTitle) redirect(`/app/${club.slug}`);

  return (
    <AuthCard
      footer={<SignedInAs />}
      formClassName="gap-6"
      panel={
        <div className="flex flex-col gap-5">
          <AuthHeadline>You&apos;re in.</AuthHeadline>
          <p className="m-0 text-[15px] leading-[1.45]">
            One quick thing for {club.name}, then you&apos;re in.
          </p>
        </div>
      }
    >
      <AuthTitle
        eyebrow="Joined"
        title={`Your role in ${club.name}`}
        description="What do you do here? It shows next to your name in this organization. Admins can change it later."
      />
      <ClubPreview name={club.name} logoUrl={orgLogoUrl(club.logo, 64)} detail="You're a member" />
      <RoleForm
        orgSlug={club.slug}
        clubName={club.name}
        initialTitle={club.title}
        availability={
          <AvailabilityLine
            clubName={club.name}
            blockedHours={club.blockedHours}
            shared={club.sharesAvailability}
          />
        }
      />
    </AuthCard>
  );
}

/** Confirms what the club sees of when the member can't meet. */
function AvailabilityLine({
  clubName,
  blockedHours,
  shared,
}: {
  clubName: string;
  blockedHours: number;
  shared: boolean;
}) {
  const text = !shared
    ? `${clubName} doesn't show members' availability.`
    : blockedHours > 0
      ? `Members of ${clubName} see your ${blockedHours} busy hours a week, never why.`
      : `You haven't marked when you can't meet. Members of ${clubName} will see busy hours only, never why.`;
  return (
    <div className="border-foreground/10 rounded-field flex items-start gap-2.5 border px-3.5 py-3 text-[14px]">
      <CalendarX className="text-muted-foreground mt-0.5 size-4 flex-none" aria-hidden="true" />
      <span className="text-muted-foreground flex flex-col gap-0.5">
        <span>{text}</span>
        {shared && (
          <Link href={profileStepHref("availability")} className="w-fit font-semibold underline">
            {blockedHours > 0 ? "Change when you can't meet" : "Mark when you can't meet"}
          </Link>
        )}
      </span>
    </div>
  );
}
