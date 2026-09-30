import {
  ArrowLeft,
  BadgeCheck,
  BookOpen,
  Building2,
  CalendarClock,
  CalendarX,
  ClipboardCheck,
  GraduationCap,
  KeyRound,
  Link2,
  Palette,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { VerifyEmailNotice } from "@/components/auth/verify-email-notice";
import {
  ChoiceTileBody,
  choiceTileClass,
  OnboardingFrame,
  StepCard,
} from "@/components/onboarding/step-card";
import { UserAvatar } from "@/components/user-avatar";
import { requireUser } from "@/lib/auth/session";
import { blockedHoursPerWeek } from "@/lib/availability";
import {
  isProfileStep,
  PROFILE_STEP_TITLES,
  PROFILE_STEPS,
  type ProfileStep,
} from "@/lib/onboarding/steps";
import { timeZoneLabel } from "@/lib/profile/timezone";
import { personalPalettes, previewTokens } from "@/lib/theme/personal";
import { THEME_PRESETS } from "@/lib/theme/presets";
import { getOnboardingProfile, type OnboardingProfile } from "@/server/onboarding/profile";

import { finishProfileSetup } from "../actions";
import { AvailabilityStep } from "../availability-step";
import { BasicsStep } from "../basics-step";
import { BioStep } from "../bio-step";
import { SchoolStep } from "../school-step";
import { ThemeStep } from "../theme-step";

export const dynamic = "force-dynamic";

/** Each step's icon and the line under its title. */
const META: Record<ProfileStep, { icon: LucideIcon; description: string }> = {
  basics: { icon: UserRound, description: "How you'll show up to your teammates." },
  school: { icon: GraduationCap, description: "What you study, and what you do in the club." },
  bio: {
    icon: Link2,
    description: "A line about you and where to find you. The link type is detected from the URL.",
  },
  theme: { icon: Palette, description: "Only changes your view. Each theme has a light and a dark set." },
  availability: {
    icon: CalendarClock,
    description: "Mark the hours you can't meet. Teammates only ever see “busy,” never why.",
  },
  review: {
    icon: ClipboardCheck,
    description: "Everything look right? You can change any of it later on your profile.",
  },
};

/**
 * Profile setup (onboarding Flow A): one step per page, so the flow
 * survives a refresh and the back button, and every step saves as the
 * member presses Continue.
 */
export default async function ProfileStepPage({ params }: PageProps<"/onboarding/profile/[step]">) {
  const { step } = await params;
  if (!isProfileStep(step)) notFound();
  const user = await requireUser();
  const profile = await getOnboardingProfile(user.id);
  if (!profile) redirect("/sign-in");

  const index = PROFILE_STEPS.indexOf(step) + 1;
  const meta = META[step];

  return (
    <OnboardingFrame wide={step === "theme" || step === "availability"}>
      {!profile.emailVerified && step === "basics" && (
        <VerifyEmailNotice
          email={profile.email}
          action="join or create an organization. You can set up your profile in the meantime"
        />
      )}
      <StepCard
        icon={meta.icon}
        step={{ index, total: PROFILE_STEPS.length }}
        title={PROFILE_STEP_TITLES[step]}
        description={meta.description}
      >
        <StepBody step={step} profile={profile} />
      </StepCard>
    </OnboardingFrame>
  );
}

function StepBody({ step, profile }: { step: ProfileStep; profile: OnboardingProfile }) {
  switch (step) {
    case "basics":
      return (
        <BasicsStep
          user={{ name: profile.name, email: profile.email, image: profile.image, avatar: profile.avatar }}
          initial={{ name: profile.name ?? "", pronouns: profile.pronouns ?? "", timezone: profile.timezone }}
        />
      );
    case "school":
      return (
        <SchoolStep
          initial={{ major: profile.major, gradYear: profile.gradYear, preferredTitle: profile.preferredTitle }}
        />
      );
    case "bio":
      return <BioStep initial={{ bio: profile.bio, links: profile.links }} />;
    case "theme":
      return <ThemeStep initial={profile.themePreference} />;
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

/** A6 · Review, then A7's branch: join with an invite code, or create an org. */
function Review({ profile }: { profile: OnboardingProfile }) {
  const theme = profile.themePreference;
  const palettes = theme ? personalPalettes(theme) : null;
  const colors = palettes && theme ? previewTokens(palettes, theme.mode === "light" ? "light" : "dark") : null;
  const accentStyle = colors ? { background: colors.primary, color: colors.onPrimary } : undefined;
  const themeName = theme
    ? theme.preset === "custom"
      ? "Custom"
      : (THEME_PRESETS.find((p) => p.id === theme.preset)?.name ?? "Default")
    : "Match my club";
  const modeName =
    theme?.mode === "light" ? "Light" : theme?.mode === "dark" ? "Dark" : theme ? "Auto" : null;
  const subtitle = [profile.pronouns, zoneShort(profile.timezone)].filter(Boolean).join(" · ");
  const home = profile.memberships[0];
  const blocked = blockedHoursPerWeek(profile.availability);

  const rows: { icon: LucideIcon; label: string; value: React.ReactNode; edit: ProfileStep }[] = [
    { icon: BookOpen, label: "Major", value: profile.major ?? "—", edit: "school" },
    { icon: GraduationCap, label: "Grad year", value: profile.gradYear ?? "—", edit: "school" },
    { icon: BadgeCheck, label: "Role", value: profile.preferredTitle ?? "—", edit: "school" },
    {
      icon: Link2,
      label: "Links",
      value: profile.links.length === 0 ? "None yet" : `${profile.links.length} added`,
      edit: "bio",
    },
    { icon: CalendarX, label: "Can't meet", value: `${blocked} hrs a week`, edit: "availability" },
    {
      icon: Palette,
      label: "Theme",
      value: (
        <span className="inline-flex items-center gap-1.5">
          {colors && <span className="size-2.5 rounded-full" style={{ background: colors.primary }} />}
          {themeName}
          {modeName ? ` · ${modeName}` : ""}
        </span>
      ),
      edit: "theme",
    },
  ];

  return (
    <div className="space-y-5">
      <div className="bg-muted/40 flex items-center gap-3.5 rounded-xl border p-3.5">
        <UserAvatar
          user={{ name: profile.name, email: profile.email, image: profile.image, avatar: profile.avatar }}
          size="lg"
          className="ring-background shrink-0 ring-2"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold">{profile.name ?? profile.email}</div>
          {subtitle && <div className="text-muted-foreground text-sm">{subtitle}</div>}
        </div>
        <Link
          href="/onboarding/profile/basics"
          className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
        >
          Edit
        </Link>
      </div>

      <dl className="divide-y rounded-xl border">
        {rows.map((row) => (
          <div key={row.label} className="group flex items-center gap-3 px-3.5 py-2.5 text-sm">
            <row.icon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
            <dt className="text-muted-foreground w-24 shrink-0">{row.label}</dt>
            <dd className="min-w-0 flex-1 truncate font-medium">{row.value}</dd>
            <Link
              href={`/onboarding/profile/${row.edit}`}
              className="text-muted-foreground hover:text-foreground text-xs opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            >
              Edit
            </Link>
          </div>
        ))}
      </dl>

      <div className="space-y-2">
        <span className="text-sm font-medium">What&apos;s next?</span>
        {home ? (
          <form action={finishProfileSetup.bind(null, "home")}>
            <button type="submit" className={choiceTileClass}>
              <ChoiceTileBody
                icon={Building2}
                primary
                accentStyle={accentStyle}
                title={`Go to ${home.name}`}
                detail="You're already a member."
              />
            </button>
          </form>
        ) : (
          <>
            <form action={finishProfileSetup.bind(null, "join")}>
              <button type="submit" className={choiceTileClass}>
                <ChoiceTileBody
                  icon={KeyRound}
                  primary
                  accentStyle={accentStyle}
                  title="Join with invite code"
                  detail="Your club's admin shared a code or a link, or emailed you an invite."
                />
              </button>
            </form>
            <form action={finishProfileSetup.bind(null, "create")}>
              <button type="submit" className={choiceTileClass}>
                <ChoiceTileBody
                  icon={Building2}
                  title="Create an organization"
                  detail="Start a new workspace for your club. You'll be its admin."
                />
              </button>
            </form>
          </>
        )}
      </div>
      <Link
        href="/onboarding/profile/availability"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Back
      </Link>
    </div>
  );
}
