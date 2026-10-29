import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { EmailsStep } from "@/app/onboarding/organization/[orgSlug]/emails-step";
import { IMessageStep } from "@/app/onboarding/organization/[orgSlug]/imessage-step";
import { ImportStep } from "@/app/onboarding/organization/[orgSlug]/import-step";
import { LabelsStep } from "@/app/onboarding/organization/[orgSlug]/labels-step";
import { ProfileForm } from "@/app/onboarding/profile/profile-form";
import { exitClass, SetupShell } from "@/components/onboarding/setup-shell";
import { requireUser } from "@/lib/auth/session";
import { setupEmailSwitches } from "@/lib/onboarding/emails";
import {
  isSetupStep,
  previousSetupStep,
  setupStepHref,
  START_HREF,
} from "@/lib/onboarding/steps";
import { withOrgTx, withUserTx } from "@/server/db/context";
import { loadTaskLabels } from "@/server/onboarding/org-setup";
import { getOnboardingProfile } from "@/server/onboarding/profile";
import { ensurePersonalSpace } from "@/server/personal/space";

export const dynamic = "force-dynamic";

/**
 * "Just me": setting up your personal workspace (PERSONAL_STEPS): import
 * from the app you're leaving, tags, emails, iMessage, then your profile.
 * "Finish later"
 * goes to the Personal home.
 */
export default async function PersonalSetupStepPage({
  params,
}: PageProps<"/onboarding/personal/[step]">) {
  const { step } = await params;
  if (!isSetupStep("personal", step)) notFound();
  const user = await requireUser();
  const [profile, space] = await Promise.all([
    getOnboardingProfile(user.id),
    ensurePersonalSpace(user.id),
  ]);
  if (!profile) redirect("/auth/session-ended");

  const home = `/app/${space.slug}`;
  const stepHref = (s: typeof step) => setupStepHref("personal", space.slug, s);
  const previous = previousSetupStep("personal", step);
  const backHref = previous ? stepHref(previous) : START_HREF;
  const base = {
    flow: "personal" as const,
    orgId: space.id,
    orgSlug: space.slug,
    backHref,
  };

  const shell = (body: React.ReactNode) => (
    <SetupShell
      subject="your personal workspace"
      exit={
        <Link href={home} className={exitClass}>
          Finish later
        </Link>
      }
    >
      {body}
    </SetupShell>
  );

  switch (step) {
    case "import":
      return shell(<ImportStep {...base} spreadsheetHref={`${home}/databases/import`} />);
    case "labels": {
      const setup = await withOrgTx(space.id, (ctx) => loadTaskLabels(ctx));
      return shell(<LabelsStep {...base} setup={setup} />);
    }
    case "emails": {
      const preferences = await withUserTx(user.id, ({ db }) =>
        db.user.findUnique({ where: { id: user.id }, select: { emailPreferences: true } }),
      );
      return shell(
        <EmailsStep
          {...base}
          orgName="your workspace"
          initial={setupEmailSwitches(preferences?.emailPreferences)}
          recapByEmail={null}
        />,
      );
    }
    case "imessage":
      return shell(<IMessageStep {...base} />);
    case "profile":
      return shell(
        <ProfileForm
          title={"Last thing: you."}
          intro={"Your photo, name and time zone."}
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
          pronouns={false}
          next={home}
          back={backHref}
          continueLabel="Open my workspace"
        />,
      );
  }
}
