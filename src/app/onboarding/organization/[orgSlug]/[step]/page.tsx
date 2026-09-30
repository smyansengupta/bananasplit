import Link from "next/link";
import { notFound } from "next/navigation";

import { OnboardingFrame, ProgressSegments, StepCard } from "@/components/onboarding/step-card";
import { can } from "@/lib/auth/permissions";
import { isOrgStep, ORG_STEP_COUNT, ORG_STEPS, type OrgStep } from "@/lib/onboarding/steps";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { loadDataSources, loadFinanceSetup, loadTeamsSetup } from "@/server/onboarding/org-setup";
import { loadSetupState } from "@/server/setup/progress";

import { DataStep, type DataConnection } from "../data-step";
import { FinanceStep } from "../finance-step";
import { LabelsStep } from "../labels-step";
import { TeamsStep } from "../teams-step";

export const dynamic = "force-dynamic";

const META: Record<OrgStep, { label: string; title: string; hint?: string; description: string }> =
  {
    data: {
      label: "B2 · Connect data",
      title: "Connect your data",
      hint: "Each connection is tested before it counts. Keys are stored encrypted.",
      description: "The services the portal reads from and writes to.",
    },
    labels: {
      label: "B3 · Label sources",
      title: "Label your data",
      description: "Name each table and tag what it’s for so reports and teams can find it.",
    },
    finance: {
      label: "B4 · Finance reports",
      title: "Finance reports",
      description: "Pick what the finance dashboard shows and when your year starts.",
    },
    teams: {
      label: "B5 · Org chart + calendars",
      title: "Teams and calendars",
      description: "Your teams become the org chart, and their meetings go on the calendar.",
    },
  };

/**
 * Org setup B2-B5 (onboarding Flow B), for an OWNER/ADMIN of the org. One
 * step per page under the org's own URL, so the flow survives a refresh and
 * can be picked up later.
 */
export default async function OrgSetupStepPage({
  params,
}: PageProps<"/onboarding/organization/[orgSlug]/[step]">) {
  const { orgSlug, step } = await params;
  if (!isOrgStep(step)) notFound();
  const { organization, role, user } = await getOrgContextBySlug(orgSlug);
  const meta = META[step];
  const index = ORG_STEPS.indexOf(step) + 2;

  const card = (body: React.ReactNode) => (
    <OnboardingFrame wide>
      <StepCard
        label={meta.label}
        hint={meta.hint}
        progress={
          <ProgressSegments total={ORG_STEP_COUNT} done={index} tone="warning" showCount={false} />
        }
        title={meta.title}
        description={meta.description}
      >
        {body}
      </StepCard>
    </OnboardingFrame>
  );

  if (!can({ role }, "settings.general.write")) {
    return card(
      <p className="text-muted-foreground text-sm">
        Organization setup is for owners and admins.{" "}
        <Link href={`/app/${organization.slug}`} className="underline underline-offset-4">
          Go to {organization.name}
        </Link>
      </p>,
    );
  }

  const base = { orgId: organization.id, orgSlug: organization.slug };

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
      return card(
        <DataStep {...base} connections={connections} connectedCount={state.connectedCount} />,
      );
    }
    case "labels": {
      const sources = await withOrgTx(organization.id, (ctx) => loadDataSources(ctx));
      return card(<LabelsStep {...base} sources={sources} />);
    }
    case "finance": {
      const state = await withOrgTx(organization.id, (ctx) => loadFinanceSetup(ctx));
      return card(<FinanceStep {...base} state={state} timezone={organization.timezone} />);
    }
    case "teams": {
      const state = await withOrgTx(organization.id, (ctx) => loadTeamsSetup(ctx));
      return card(<TeamsStep {...base} state={state} currentUserId={user.id} />);
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
