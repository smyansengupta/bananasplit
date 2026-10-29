import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ProfileForm } from "@/app/onboarding/profile/profile-form";

import { BrandMark } from "@/components/marketing/brand-mark";
import { BRANDS, type BrandGroup } from "@/components/marketing/brands";
import { exitClass, SetupCard, SetupShell, StepIntro } from "@/components/onboarding/setup-shell";
import { absoluteAppUrl } from "@/lib/app-url";
import { can } from "@/lib/auth/permissions";
import { bringSections } from "@/lib/onboarding/bring";
import { setupEmailSwitches } from "@/lib/onboarding/emails";
import { isOrgStep, previousSetupStep, setupStepHref } from "@/lib/onboarding/steps";
import { orgLogoUrl } from "@/lib/org-logo";
import { getOrgContextBySlug, withOrgTx, withUserTx } from "@/server/db/context";
import { getOrCreateJoinCode } from "@/server/onboarding/join-code";
import { loadEventTypes, loadTaskLabels, loadTeamsSetup } from "@/server/onboarding/org-setup";
import { getOnboardingProfile } from "@/server/onboarding/profile";
import { readBring } from "@/server/personal/bring-cookie";
import { bringableIds, loadBringable } from "@/server/personal/move";

import { OrgBasicsStep } from "../basics-step";
import { BringStep } from "../bring-step";
import { EmailsStep } from "../emails-step";
import { EventsStep } from "../events-step";
import { IMessageStep } from "../imessage-step";
import { ImportStep } from "../import-step";
import { InviteStep } from "../invite-step";
import { LabelsStep } from "../labels-step";
import { PictureStep } from "../picture-step";
import { TeamsStep } from "../teams-step";
import { ToolsStep, type ToolTile } from "../tools-step";

export const dynamic = "force-dynamic";

/** What each kind of app does once connected (Connect tools). */
const TOOL_DOES: Record<BrandGroup, string> = {
  notes: "Meeting notes file themselves",
  meetings: "Calls booked from the calendar",
  ai: "Ask and add work from your AI",
  inbox: "Email and calendars, as tasks",
  data: "Your database, kept in sync",
};

/**
 * Setting up an organization (ORG_STEPS), for an OWNER/ADMIN of it, after
 * its basics, your profile last. One step per page under the
 * organization's URL, so the flow survives a refresh and can be picked up
 * later; "Save and exit" goes in, since each step saves as it continues.
 */
export default async function OrgSetupStepPage({
  params,
  searchParams,
}: PageProps<"/onboarding/organization/[orgSlug]/[step]">) {
  const { orgSlug, step } = await params;
  if (!isOrgStep(step)) notFound();
  const { organization, role, user } = await getOrgContextBySlug(orgSlug);
  // Organization setup is for organizations; Personal has its own (/onboarding/personal).
  if (organization.kind === "PERSONAL") notFound();
  const stepHref = (s: typeof step) => setupStepHref("org", organization.slug, s);
  const previous = previousSetupStep("org", step);
  // Basics, the first, has no Back: the organization is made, and the start
  // screen would only offer to make another.
  const backHref = previous ? stepHref(previous) : null;

  const shell = (body: React.ReactNode) => (
    <SetupShell
      subject={organization.name}
      exit={
        <Link href={`/app/${organization.slug}?welcome=1`} className={exitClass}>
          Save and exit
        </Link>
      }
    >
      {body}
    </SetupShell>
  );

  if (!can({ role }, "settings.general.write")) {
    return shell(
      <SetupCard>
        <StepIntro title="Setup is for the organization's admins.">
          Ask an owner or admin of {organization.name} to finish it.
        </StepIntro>
        <Link href={`/app/${organization.slug}`} className="mt-6 font-semibold underline">
          Go to {organization.name}
        </Link>
      </SetupCard>,
    );
  }

  const base = {
    flow: "org" as const,
    orgId: organization.id,
    orgSlug: organization.slug,
    backHref,
  };

  switch (step) {
    case "basics":
      return shell(
        <OrgBasicsStep
          {...base}
          name={organization.name}
          slug={organization.slug}
          timezone={organization.timezone}
        />,
      );
    case "import":
      return shell(
        <ImportStep {...base} spreadsheetHref={`/app/${organization.slug}/databases/import`} />,
      );
    case "picture":
      return shell(
        <PictureStep
          {...base}
          name={organization.name}
          logoUrl={orgLogoUrl(organization.logo, 256)}
        />,
      );
    case "labels": {
      const setup = await withOrgTx(organization.id, (ctx) => loadTaskLabels(ctx));
      return shell(<LabelsStep {...base} setup={setup} />);
    }
    case "events": {
      const { types } = await withOrgTx(organization.id, (ctx) => loadEventTypes(ctx));
      return shell(<EventsStep {...base} initial={types} />);
    }
    case "teams": {
      const state = await withOrgTx(organization.id, (ctx) => loadTeamsSetup(ctx));
      return shell(<TeamsStep {...base} state={state} currentUserId={user.id} />);
    }
    case "emails": {
      const [preferences, recap] = await Promise.all([
        withUserTx(user.id, ({ db }) =>
          db.user.findUnique({ where: { id: user.id }, select: { emailPreferences: true } }),
        ),
        withOrgTx(organization.id, ({ db }) =>
          db.orgSettings.findUnique({
            where: { organizationId: organization.id },
            select: { pulseEmail: true },
          }),
        ),
      ]);
      return shell(
        <EmailsStep
          {...base}
          orgName={organization.name}
          initial={setupEmailSwitches(preferences?.emailPreferences)}
          recapByEmail={recap?.pulseEmail ?? true}
        />,
      );
    }
    case "imessage":
      return shell(<IMessageStep {...base} />);
    case "tools": {
      const tools: ToolTile[] = BRANDS.map((brand) => ({
        slug: brand.slug,
        name: brand.name,
        does: TOOL_DOES[brand.group],
        logo: <BrandMark brand={brand} size={34} />,
      }));
      return shell(<ToolsStep {...base} tools={tools} />);
    }
    case "invite": {
      const canInvite = can({ role }, "members.invite");
      const { code, invites } = await withOrgTx(organization.id, async ({ db }) => ({
        code: canInvite ? await getOrCreateJoinCode(db, organization.id, user.id) : null,
        invites: canInvite
          ? await db.invitation.findMany({
              where: {
                organizationId: organization.id,
                acceptedAt: null,
                expiresAt: { gt: new Date() },
              },
              orderBy: { createdAt: "desc" },
              take: 20,
              select: { email: true, role: true },
            })
          : [],
      }));
      return shell(
        <InviteStep
          {...base}
          code={code?.enabled ? code.code : null}
          joinUrl={absoluteAppUrl("/onboarding/join")}
          invites={invites}
        />,
      );
    }
    case "profile": {
      const profile = await getOnboardingProfile(user.id);
      if (!profile) redirect("/auth/session-ended");
      return shell(
        <ProfileForm
          title="Last thing: you."
          intro={`How ${organization.name} will see you.`}
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
          next={`/app/${organization.slug}?welcome=1`}
          back={backHref ?? undefined}
          continueLabel={`Go to ${organization.name}`}
        />,
      );
    }
    case "bring": {
      // ?from=move: Move to a club, for a club that's already set up.
      // ?bring={id}: the item to start ticked (else one remembered by
      // "Start a club with this"); only one of the user's own items counts.
      const query = await searchParams;
      const fromMove = query.from === "move";
      const done = fromMove ? `/app/${organization.slug}` : stepHref("profile");
      const bringable = await loadBringable(user.id);
      if (!bringable || bringable.total === 0) redirect(done);
      const wanted = (typeof query.bring === "string" ? query.bring : null) ?? (await readBring());
      const preselected = wanted && bringableIds(bringable).has(wanted) ? [wanted] : [];
      return shell(
        <BringStep
          {...base}
          backHref={fromMove ? null : backHref}
          clubName={organization.name}
          sections={bringSections(bringable)}
          preselected={preselected}
          welcome={!fromMove}
        />,
      );
    }
  }
}
