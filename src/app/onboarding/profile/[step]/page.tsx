import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { VerifyEmailNotice } from "@/components/auth/verify-email-notice";
import { OnboardingFrame, ProgressSegments, StepCard } from "@/components/onboarding/step-card";
import { UserAvatar } from "@/components/user-avatar";
import { requireUser } from "@/lib/auth/session";
import { blockedHoursPerWeek } from "@/lib/availability";
import {
  isProfileStep,
  PROFILE_STEP_TITLES,
  PROFILE_STEPS,
  type ProfileStep,
} from "@/lib/onboarding/steps";
import { personalPalettes, previewTokens } from "@/lib/theme/personal";
import { THEME_PRESETS } from "@/lib/theme/presets";
import { timeZoneLabel } from "@/lib/profile/timezone";
import { getOnboardingProfile, type OnboardingProfile } from "@/server/onboarding/profile";

import { finishProfileSetup } from "../actions";
import { AvailabilityStep } from "../availability-step";
import { BasicsStep } from "../basics-step";
import { BioStep } from "../bio-step";
import { SchoolStep } from "../school-step";
import { ThemeStep } from "../theme-step";

export const dynamic = "force-dynamic";

/** The flowchart's labels and the one-line notes above some cards. */
const LABELS: Record<ProfileStep, { label: string; hint?: string; description?: string }> = {
  basics: { label: "A1 · Basics" },
  school: { label: "A2 · School + role" },
  bio: { label: "A3 · Bio + links", hint: "Up to 8 links. The type is detected from the URL." },
  theme: {
    label: "A4 · Theme",
    hint: "Pick a preset or build your own. The choice carries into the review.",
    description: "Only changes your view. Each has a light and dark set.",
  },
  availability: {
    label: "A5 · When you can’t meet",
    hint: "Click or drag across the week to block or free an hour. Teammates see “Busy,” never the label.",
    description: "Drag across the week to block time. Teammates only see “busy.”",
  },
  review: { label: "A6 · Review" },
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
  const meta = LABELS[step];

  return (
    <OnboardingFrame wide={step === "theme" || step === "availability"}>
      {!profile.emailVerified && step === "basics" && (
        <VerifyEmailNotice
          email={profile.email}
          action="join or create an organization. You can set up your profile in the meantime"
        />
      )}
      <StepCard
        label={meta.label}
        hint={meta.hint}
        progress={<ProgressSegments total={PROFILE_STEPS.length} done={index} />}
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
        />
      );
    case "school":
      return (
        <SchoolStep
          initial={{
            major: profile.major,
            gradYear: profile.gradYear,
            preferredTitle: profile.preferredTitle,
          }}
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
  const colors =
    palettes && theme ? previewTokens(palettes, theme.mode === "light" ? "light" : "dark") : null;
  const accentStyle = colors ? { background: colors.primary, color: colors.onPrimary } : undefined;
  const themeName = theme
    ? theme.preset === "custom"
      ? "Custom"
      : (THEME_PRESETS.find((p) => p.id === theme.preset)?.name ?? "Default")
    : "Organization's theme";
  const modeName = theme?.mode === "light" ? "Light" : theme?.mode === "dark" ? "Dark" : null;
  const subtitle = [profile.pronouns, zoneShort(profile.timezone)].filter(Boolean).join(" · ");
  const home = profile.memberships[0];

  const rows: [string, React.ReactNode][] = [
    ["Major", profile.major ?? "—"],
    ["Grad year", profile.gradYear ?? "—"],
    ["Role", profile.preferredTitle ?? "—"],
    ["Links", profile.links.length],
    ["Blocked", `${blockedHoursPerWeek(profile.availability)} hrs / week`],
    [
      "Theme",
      <span key="t" className="flex items-center gap-1.5">
        {colors && <span className="size-2 rounded-full" style={{ background: colors.primary }} />}
        {themeName}
        {modeName ? ` · ${modeName}` : ""}
      </span>,
    ],
  ];

  return (
    <div className="space-y-4">
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
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{profile.name ?? profile.email}</div>
          {subtitle && <div className="text-muted-foreground text-xs">{subtitle}</div>}
        </div>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      <div className="space-y-2 border-t pt-3">
        <span className="text-xs font-medium">Next</span>
        {home ? (
          <form action={finishProfileSetup.bind(null, "home")}>
            <button
              type="submit"
              className="bg-primary text-primary-foreground w-full rounded-lg px-3 py-2 text-sm font-semibold"
              style={accentStyle}
            >
              Go to {home.name}
            </button>
          </form>
        ) : (
          <>
            <form action={finishProfileSetup.bind(null, "join")}>
              <button
                type="submit"
                className="bg-primary text-primary-foreground w-full rounded-lg px-3 py-2 text-sm font-semibold"
                style={accentStyle}
              >
                Join with invite code
              </button>
            </form>
            <form action={finishProfileSetup.bind(null, "create")}>
              <button
                type="submit"
                className="hover:bg-muted w-full rounded-lg border px-3 py-2 text-sm"
              >
                Create an organization
              </button>
            </form>
          </>
        )}
        <Link
          href="/onboarding/profile/availability"
          className="text-muted-foreground block text-center text-xs hover:underline"
        >
          Back
        </Link>
      </div>
    </div>
  );
}
