import Link from "next/link";
import { notFound } from "next/navigation";

import { ClubBasicsStep } from "@/app/onboarding/organization/club-basics-step";
import { EmailsStep } from "@/app/onboarding/organization/[orgSlug]/emails-step";
import { setupEmailSwitches } from "@/lib/onboarding/emails";
import { EventsStep } from "@/app/onboarding/organization/[orgSlug]/events-step";
import { IMessageStep } from "@/app/onboarding/organization/[orgSlug]/imessage-step";
import { ImportStep } from "@/app/onboarding/organization/[orgSlug]/import-step";
import { InviteStep } from "@/app/onboarding/organization/[orgSlug]/invite-step";
import { LabelsStep } from "@/app/onboarding/organization/[orgSlug]/labels-step";
import { PictureStep } from "@/app/onboarding/organization/[orgSlug]/picture-step";
import { TeamsStep } from "@/app/onboarding/organization/[orgSlug]/teams-step";
import { ToolsStep } from "@/app/onboarding/organization/[orgSlug]/tools-step";
import { ProfileForm } from "@/app/onboarding/profile/profile-form";
import { StartScreen } from "@/app/onboarding/start/start-screen";
import { BrandRoot } from "@/components/brand/brand-root";
import { BrandMark } from "@/components/marketing/brand-mark";
import { BRANDS } from "@/components/marketing/brands";
import { PreviewFlow } from "@/components/onboarding/preview-flow";
import { exitClass, SetupShell } from "@/components/onboarding/setup-shell";

/**
 * /dev/onboarding/<screen>: every onboarding screen with sample data, for
 * looking through the flow locally without a database or an account (the
 * real pages read both). The bar at the top names the flow and steps
 * between screens, and every button inside (Continue, Skip, Join, Create)
 * moves to the next screen instead of saving (PreviewFlow). Development
 * only (the /dev layout).
 */

const FLOWS = {
  Start: ["start"],
  "Create an organization": [
    "basics",
    "import",
    "picture",
    "labels",
    "events",
    "teams",
    "emails",
    "imessage",
    "tools",
    "invite",
    "profile",
  ],
  "Join an organization": ["join-profile"],
  "Just me": [
    "personal-import",
    "personal-labels",
    "personal-emails",
    "personal-imessage",
    "personal-profile",
  ],
} as const;

const SCREENS = Object.values(FLOWS).flat() as string[];
const flowOf = (screen: string) =>
  Object.entries(FLOWS).find(([, list]) => (list as readonly string[]).includes(screen))![0];
/** The screen before, in the same flow; a flow's first screen goes back to the start. */
const backOf = (screen: string): string => {
  const list = FLOWS[flowOf(screen) as keyof typeof FLOWS] as readonly string[];
  return `/dev/onboarding/${list[list.indexOf(screen) - 1] ?? "start"}`;
};

/** The next screen in the same flow; a flow's last screen goes back to the start. */
const nextOf = (screen: string): string => {
  const list = FLOWS[flowOf(screen) as keyof typeof FLOWS] as readonly string[];
  return list[list.indexOf(screen) + 1] ?? "start";
};

const ME = { name: "Jackson Lamoureux", email: "jackson@example.com", image: null, avatar: null };
const PROFILE = { name: ME.name, pronouns: "", timezone: null, bio: null, links: [] };

export default async function DevOnboardingPage({
  params,
}: {
  params: Promise<{ screen: string }>;
}) {
  const { screen } = await params;
  if (!SCREENS.includes(screen)) notFound();
  const at = SCREENS.indexOf(screen);
  const prev = SCREENS[at - 1];
  const next = SCREENS[at + 1];

  return (
    <BrandRoot>
      <nav className="bg-ink text-cream sticky top-0 z-50 flex items-center gap-3 px-4 py-2 text-[13px]">
        <span className="font-semibold">Dev preview</span>
        <span className="opacity-70">
          {flowOf(screen)} · {screen}
        </span>
        <span className="ml-auto flex gap-3">
          {prev && <Link href={`/dev/onboarding/${prev}`}>← {prev}</Link>}
          {next && <Link href={`/dev/onboarding/${next}`}>{next} →</Link>}
        </span>
      </nav>
      <PreviewFlow next={`/dev/onboarding/${nextOf(screen)}`}>
        <Body screen={screen} />
      </PreviewFlow>
    </BrandRoot>
  );
}

function Body({ screen }: { screen: string }) {
  const exit = <span className={exitClass}>Save and exit</span>;

  if (screen === "start") {
    return (
      <StartScreen
        first="Jackson"
        invites={[{ id: "inv_1", role: "MEMBER", orgName: "Robotics Club", orgLogoUrl: null }]}
        exit={<span className={exitClass}>Sign out</span>}
        hrefs={{
          join: "/dev/onboarding/join-profile",
          create: "/dev/onboarding/basics",
          personal: "/dev/onboarding/personal-import",
        }}
      />
    );
  }

  if (screen === "basics") {
    return (
      <SetupShell subject="your organization" exit={exit}>
        <ClubBasicsStep requiresCode={false} />
      </SetupShell>
    );
  }

  const personal = screen.startsWith("personal-");
  const joining = screen === "join-profile";
  const step = screen.replace(/^(personal|join)-/, "");
  const flow = personal ? ("personal" as const) : ("org" as const);
  const base = { flow, orgId: "org_preview", orgSlug: "acme", backHref: backOf(screen) };
  const subject = personal
    ? "your personal workspace"
    : joining
      ? "you in Robotics Club"
      : "Acme Labs";

  const body = (() => {
    switch (step) {
      case "import":
        return <ImportStep {...base} spreadsheetHref="#" />;
      case "picture":
        return <PictureStep {...base} name="Acme Labs" logoUrl={null} />;
      case "labels":
        return <LabelsStep {...base} setup={{ labels: [], tasks: [] }} />;
      case "events":
        return <EventsStep {...base} initial={[]} />;
      case "teams":
        return (
          <TeamsStep
            {...base}
            state={{
              members: [{ userId: "u1", name: ME.name }],
              showMemberAvailability: true,
              googleConnected: false,
              hasPublishedChart: false,
            }}
            currentUserId="u1"
          />
        );
      case "emails":
        return (
          <EmailsStep
            {...base}
            orgName={personal ? "your workspace" : "Acme Labs"}
            initial={setupEmailSwitches(null)}
            recapByEmail={personal ? null : true}
          />
        );
      case "imessage":
        return <IMessageStep {...base} />;
      case "tools":
        return (
          <ToolsStep
            {...base}
            tools={BRANDS.map((b) => ({
              slug: b.slug,
              name: b.name,
              does: b.group,
              logo: <BrandMark brand={b} size={34} />,
            }))}
          />
        );
      case "invite":
        return (
          <InviteStep
            {...base}
            code="RPKAYWSF"
            joinUrl="http://localhost:3000/join"
            invites={[]}
          />
        );
      case "profile":
        return (
          <ProfileForm
            back={backOf(screen)}
            pronouns={!personal}
            title={joining ? "You're in Robotics Club." : "Last thing: you."}
            intro={personal ? "Your photo, name and time zone." : "How they'll see you."}
            user={ME}
            initial={PROFILE}
            next="#"
            continueLabel={
              personal ? "Open my workspace" : joining ? "Go to Robotics Club" : "Go to Acme Labs"
            }
          />
        );
      default:
        return null;
    }
  })();

  return (
    <SetupShell subject={subject} exit={exit}>
      {body}
    </SetupShell>
  );
}
