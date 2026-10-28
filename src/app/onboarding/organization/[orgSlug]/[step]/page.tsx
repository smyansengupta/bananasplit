import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { exitClass, SetupCard, SetupShell, StepIntro } from "@/components/onboarding/setup-shell";
import { can } from "@/lib/auth/permissions";
import { absoluteAppUrl } from "@/lib/app-url";
import { bringSections } from "@/lib/onboarding/bring";
import {
  isOrgStep,
  ORG_STEP_COUNT,
  ORG_STEP_NAMES,
  ORG_STEPS,
  orgStepHref,
  previousOrgStep,
} from "@/lib/onboarding/steps";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { getOrCreateJoinCode } from "@/server/onboarding/join-code";
import { DEFAULT_PULSE_SETTINGS } from "@/lib/pulse/settings";
import { loadFinanceSetup, loadTaskLabels, loadTeamsSetup } from "@/server/onboarding/org-setup";
import { loadPulseSettings } from "@/server/onboarding/pulse";
import { readBring } from "@/server/personal/bring-cookie";
import { bringableIds, loadBringable } from "@/server/personal/move";
import { loadSetupState } from "@/server/setup/progress";

import { BringStep } from "../bring-step";
import { DataStep, type DataConnection } from "../data-step";
import { FinanceStep } from "../finance-step";
import { InviteStep } from "../invite-step";
import { LabelsStep } from "../labels-step";
import { PulseStep } from "../pulse-step";
import { TeamsStep } from "../teams-step";

export const dynamic = "force-dynamic";

/**
 * Club setup B2-B7 (onboarding Flow B), for an OWNER/ADMIN of the club, in
 * the one step screen (design: App screens, 05). One step per page under
 * the club's own URL, so the flow survives a refresh and can be picked up
 * later; "Save and exit" goes to the club, since each step saves as it
 * continues.
 */
export default async function OrgSetupStepPage({
  params,
  searchParams,
}: PageProps<"/onboarding/organization/[orgSlug]/[step]">) {
  const { orgSlug, step } = await params;
  if (!isOrgStep(step)) notFound();
  const { organization, role, user } = await getOrgContextBySlug(orgSlug);
  // Club setup is for clubs: a Personal space has no team, labels or invites.
  if (organization.kind === "PERSONAL") notFound();
  // B1 is step 1; B2 is the first of ORG_STEPS.
  const index = ORG_STEPS.indexOf(step) + 2;
  const total = ORG_STEP_COUNT;
  const previous = previousOrgStep(step);
  const backHref = previous
    ? orgStepHref(organization.slug, previous)
    : `/app/${organization.slug}`;

  const shell = (body: React.ReactNode) => (
    <SetupShell
      subject={organization.name}
      steps={ORG_STEP_NAMES}
      current={index}
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
        <StepIntro index={index} total={total} title="Setup is for the organization's admins.">
          Ask an owner or admin of {organization.name} to finish it.
        </StepIntro>
        <Link href={`/app/${organization.slug}`} className="mt-6 font-semibold underline">
          Go to {organization.name}
        </Link>
      </SetupCard>,
    );
  }

  const base = { orgId: organization.id, orgSlug: organization.slug, index, total, backHref };

  switch (step) {
    case "data": {
      const state = await withOrgTx(organization.id, ({ db }) =>
        loadSetupState(db, organization.id),
      );
      const connections: DataConnection[] = state.steps.map((s) => ({
        id: s.step.id,
        title: s.step.title,
        summary: s.step.summary,
        status: s.status,
        detail: connectionDetail(s.step.id, s.config, s.last4),
        lastError: s.lastError,
      }));
      return shell(
        <DataStep {...base} connections={connections} connectedCount={state.connectedCount} />,
      );
    }
    case "labels": {
      const setup = await withOrgTx(organization.id, (ctx) => loadTaskLabels(ctx));
      return shell(<LabelsStep {...base} setup={setup} />);
    }
    case "finance": {
      const state = await withOrgTx(organization.id, (ctx) => loadFinanceSetup(ctx));
      return shell(<FinanceStep {...base} state={state} timezone={organization.timezone} />);
    }
    case "teams": {
      const state = await withOrgTx(organization.id, (ctx) => loadTeamsSetup(ctx));
      return shell(<TeamsStep {...base} state={state} currentUserId={user.id} />);
    }
    case "pulse": {
      const saved = await withOrgTx(organization.id, (ctx) => loadPulseSettings(ctx));
      return shell(
        <PulseStep
          {...base}
          clubName={organization.name}
          initial={saved ?? DEFAULT_PULSE_SETTINGS}
        />,
      );
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
          me={{ name: user.name, email: user.email }}
          code={code?.enabled ? code.code : null}
          joinUrl={absoluteAppUrl("/onboarding/join")}
          invites={invites}
        />,
      );
    }
    case "bring": {
      // ?from=move: Move to a club, for a club that's already set up.
      // ?bring={id}: the item to start ticked (else one remembered by
      // "Start a club with this"); only one of the user's own items counts.
      const query = await searchParams;
      const fromMove = query.from === "move";
      const done = fromMove ? `/app/${organization.slug}` : `/app/${organization.slug}?welcome=1`;
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

/** One mono line under a connection: what it points at, never a secret. */
function connectionDetail(
  id: string,
  config: Record<string, unknown>,
  last4: string | null,
): string | null {
  const str = (k: string) => (typeof config[k] === "string" ? (config[k] as string) : null);
  switch (id) {
    case "data":
      return str("projectRef") ? `${str("projectRef")}.supabase.co` : null;
    case "calendar":
      return str("publicCalendarId");
    case "email":
      return str("fromAddress");
    case "claude":
      return last4 ? `sk-…${last4}` : null;
    default:
      return null;
  }
}
