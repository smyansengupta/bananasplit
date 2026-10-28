import {
  BookOpen,
  CalendarX,
  GraduationCap,
  Link2,
  NotebookPen,
  type IconComponent,
} from "@/components/icons";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { VerifyEmailNotice } from "@/components/auth/verify-email-notice";
import {
  ContinuePill,
  exitClass,
  PreviewHeader,
  PreviewTile,
  SetupCard,
  SetupShell,
  StepFooter,
  StepIntro,
} from "@/components/onboarding/setup-shell";
import { UserAvatar } from "@/components/user-avatar";
import { safeCallbackUrl } from "@/lib/auth/callback-url";
import { requireUser } from "@/lib/auth/session";
import { blockedHoursPerWeek } from "@/lib/availability";
import {
  FIRST_PROFILE_STEP,
  isProfileStep,
  PROFILE_STEP_TITLES,
  PROFILE_STEPS,
  profileStepHref,
  type ProfileStep,
} from "@/lib/onboarding/steps";
import { timeZoneLabel } from "@/lib/profile/timezone";
import { getOnboardingProfile, type OnboardingProfile } from "@/server/onboarding/profile";

import { finishProfileSetup } from "../actions";
import { AvailabilityStep } from "../availability-step";
import { BasicsStep } from "../basics-step";
import { BioStep } from "../bio-step";
import { SchoolStep } from "../school-step";

export const dynamic = "force-dynamic";

/** Each step's question and the line under it. */
const META: Record<ProfileStep, { title: string; description: string }> = {
  basics: {
    title: "A real profile about you.",
    description:
      "Your organizations see it. Start with your name and photo; everything after this step is optional.",
  },
  school: {
    title: "What do you study?",
    description:
      "Your major and when you graduate. Your role in an organization is set when you join it.",
  },
  bio: {
    title: "A line about you.",
    description: "And where to find you. The link type is detected from the URL.",
  },
  availability: {
    title: "When can't you meet?",
    description:
      "Mark the hours you can't meet, so meetings land when you're free. Organizations only ever see “busy,” never why.",
  },
  review: {
    title: "Everything look right?",
    description: "Change any of it later on your profile.",
  },
};

/** The availability editor needs the card's full width. */
const WIDE: ReadonlySet<ProfileStep> = new Set(["availability"]);

/**
 * "Your profile" (onboarding Flow A, docs/features/personal-and-clubs.md):
 * basics -> school -> bio and links -> when you can't meet -> review, one
 * step per page, so the flow survives a refresh and the back button. Each
 * step saves as the member presses Continue; every step after the first
 * has Skip, and "Finish later" goes to the Personal dashboard, which offers
 * what was skipped. Coming from somewhere specific (?callbackUrl=: an invite
 * link, a poll, "Start a club"), step 1 returns there.
 */
export default async function ProfileStepPage({
  params,
  searchParams,
}: PageProps<"/onboarding/profile/[step]">) {
  const { step } = await params;
  const after = safeCallbackUrl((await searchParams).callbackUrl);
  if (!isProfileStep(step)) notFound();
  const user = await requireUser();
  const profile = await getOnboardingProfile(user.id);
  if (!profile) redirect("/auth/session-ended");
  // Step 1 comes first: the later steps are for an account that has one.
  if (step !== FIRST_PROFILE_STEP && !profile.onboardedAt) {
    redirect(profileStepHref(FIRST_PROFILE_STEP));
  }

  const index = PROFILE_STEPS.indexOf(step) + 1;
  const meta = META[step];

  return (
    <SetupShell
      subject="your profile"
      steps={PROFILE_STEPS.map((s) => PROFILE_STEP_TITLES[s])}
      current={index}
      exit={
        profile.onboardedAt ? (
          <form action={finishProfileSetup}>
            <button type="submit" className={exitClass}>
              Finish later
            </button>
          </form>
        ) : (
          <SignOutButton className="text-muted-foreground hover:text-foreground h-auto p-0 text-[14px] font-semibold hover:bg-transparent" />
        )
      }
    >
      <SetupCard preview={WIDE.has(step) ? undefined : <ProfilePreview profile={profile} />}>
        <StepIntro index={index} total={PROFILE_STEPS.length} title={meta.title}>
          {meta.description}
        </StepIntro>
        {!profile.emailVerified && step === FIRST_PROFILE_STEP && (
          <div className="mt-4">
            <VerifyEmailNotice
              email={profile.email}
              action="join or start an organization. You can set up your profile in the meantime"
            />
          </div>
        )}
        <div className="mt-[22px] flex flex-1 flex-col">
          <StepBody step={step} profile={profile} after={after} />
        </div>
      </SetupCard>
    </SetupShell>
  );
}

/**
 * The preview: the member card teammates will see, from what's saved so
 * far. It fills in as each step saves.
 */
function ProfilePreview({ profile }: { profile: OnboardingProfile }) {
  const subtitle = [profile.pronouns, zoneShort(profile.timezone)].filter(Boolean).join(" · ");
  const school = [profile.major, profile.gradYear ? `Class of ${profile.gradYear}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <PreviewHeader meta="Your profile card" />
      <PreviewTile className="gap-3.5 p-5">
        <div className="flex items-center gap-3">
          <UserAvatar
            user={{
              name: profile.name,
              email: profile.email,
              image: profile.image,
              avatar: profile.avatar,
            }}
            size="lg"
            className="shrink-0"
          />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-[16px] font-bold">{profile.name ?? profile.email}</span>
            {subtitle && <span className="text-muted-foreground text-[13px]">{subtitle}</span>}
          </span>
        </div>
        {school && <span className="text-muted-foreground text-[14px]">{school}</span>}
        {profile.bio && (
          <p className="text-muted-foreground m-0 text-[14px] leading-[1.5] whitespace-pre-line">
            {profile.bio}
          </p>
        )}
        {profile.links.length > 0 && (
          <span className="text-muted-foreground text-[13px]">
            {profile.links.length} {profile.links.length === 1 ? "link" : "links"}
          </span>
        )}
      </PreviewTile>
      <p className="text-muted-foreground m-0 mt-auto text-[12px] leading-[1.5]">
        Your card fills in as you go. Change any of it later on your profile.
      </p>
    </>
  );
}

function StepBody({
  step,
  profile,
  after,
}: {
  step: ProfileStep;
  profile: OnboardingProfile;
  after: string | null;
}) {
  switch (step) {
    case "basics":
      return (
        <BasicsStep
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
          }}
          after={after}
        />
      );
    case "school":
      return <SchoolStep initial={{ major: profile.major, gradYear: profile.gradYear }} />;
    case "bio":
      return <BioStep initial={{ bio: profile.bio, links: profile.links }} />;
    case "availability":
      return <AvailabilityStep initial={profile.availability} />;
    case "review":
      return <Review profile={profile} />;
  }
}

function zoneShort(zone: string | null): string {
  if (!zone) return "";
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value;
    return part ?? timeZoneLabel(zone);
  } catch {
    return zone;
  }
}

/** Step 5 · Review: what was saved, an Edit on each row, then Done (the Personal dashboard). */
function Review({ profile }: { profile: OnboardingProfile }) {
  const subtitle = [profile.pronouns, zoneShort(profile.timezone)].filter(Boolean).join(" · ");
  const blocked = blockedHoursPerWeek(profile.availability);

  const rows: { icon: IconComponent; label: string; value: React.ReactNode; edit: ProfileStep }[] = [
    { icon: BookOpen, label: "Major", value: profile.major ?? "—", edit: "school" },
    { icon: GraduationCap, label: "Grad year", value: profile.gradYear ?? "—", edit: "school" },
    {
      icon: NotebookPen,
      label: "Bio",
      value: profile.bio ? profile.bio : "—",
      edit: "bio",
    },
    {
      icon: Link2,
      label: "Links",
      value: profile.links.length === 0 ? "None yet" : `${profile.links.length} added`,
      edit: "bio",
    },
    {
      icon: CalendarX,
      label: "Can't meet",
      value: blocked > 0 ? `${blocked} hrs a week` : "Nothing marked",
      edit: "availability",
    },
  ];

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="bg-muted/40 rounded-field flex items-center gap-3.5 border p-3.5">
        <UserAvatar
          user={{
            name: profile.name,
            email: profile.email,
            image: profile.image,
            avatar: profile.avatar,
          }}
          size="lg"
          className="ring-background shrink-0 ring-2"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold">{profile.name ?? profile.email}</div>
          {subtitle && <div className="text-muted-foreground text-sm">{subtitle}</div>}
        </div>
        <Link
          href={profileStepHref("basics")}
          className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
        >
          Edit
        </Link>
      </div>

      <dl className="rounded-field divide-y border">
        {rows.map((row) => (
          <div key={row.label} className="group flex items-center gap-3 px-3.5 py-2.5 text-sm">
            <row.icon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
            <dt className="text-muted-foreground w-24 shrink-0">{row.label}</dt>
            <dd className="min-w-0 flex-1 truncate font-medium">{row.value}</dd>
            <Link
              href={profileStepHref(row.edit)}
              aria-label={`Edit ${row.label.toLowerCase()}`}
              className="text-muted-foreground hover:text-foreground text-xs opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            >
              Edit
            </Link>
          </div>
        ))}
      </dl>

      <form action={finishProfileSetup} className="contents">
        <StepFooter back={{ href: profileStepHref("availability") }}>
          <ContinuePill type="submit">Done</ContinuePill>
        </StepFooter>
      </form>
    </div>
  );
}
