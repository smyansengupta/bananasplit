import { Lock } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { ProgressBar } from "@/components/setup/setup-ui";
import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { isGoogleConfigured } from "@/server/integrations/google";
import { clampRefreshSeconds, getReport } from "@/server/reports/cache";
import { reportTier } from "@/server/reports/tier";
import { SETUP_STEPS, SETUP_TOTAL_MINUTES, isSetupStepId } from "@/server/setup/catalog";
import { loadSetupState } from "@/server/setup/progress";
import { loadDataSummary } from "@/server/setup/summary";
import type { AttendanceReport } from "@/server/reports/types";

import { FinishPanel } from "./finish-panel";
import { ResultPanel } from "./result-panel";
import { SetupSpine } from "./setup-spine";
import { StepPanel } from "./step-panel";
import type { SetupProgressView, SetupStepView } from "./view";

/**
 * The guided setup (OWNER/ADMIN): one service at a time, with what it
 * unlocks, what it costs, where the credential lives, a paste field and a
 * test that says what to change when it fails.
 *
 * The open step is ?step=, not client state, so the flow survives a
 * refresh, a bookmark and the back button, and every panel can be a server
 * component with its own data. A step that is CONNECTED renders its result
 * instead of its form: after a save the client calls router.refresh() and
 * this page hands back the screen showing what the connection just did.
 *
 * Progress is read from the OrgIntegration rows every time (never cached,
 * never stored), so a service that stopped working shows as broken here the
 * moment its next test fails.
 */

export const dynamic = "force-dynamic";

export default async function SetupPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/setup">) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const { organization, role } = await getOrgContextBySlug(orgSlug);

  if (!can({ role }, "integrations.write")) {
    return (
      <div className="mx-auto max-w-lg py-10">
        <EmptyState
          icon={Lock}
          title="Setup is for owners and admins"
          description="Connecting a club's accounts means handling its credentials, so it is limited to owners and admins. Ask one of them to run it."
          action={
            <Link href={`/app/${orgSlug}`} className="text-sm underline underline-offset-4">
              Back to the overview
            </Link>
          }
        />
      </div>
    );
  }

  const { state, summary } = await withOrgTx(organization.id, async ({ db }) => ({
    state: await loadSetupState(db, organization.id),
    summary: await loadDataSummary(db, organization.id, role, organization.slug),
  }));

  const steps: SetupStepView[] = state.steps.map((s) => ({
    id: s.step.id,
    status: s.status,
    hasSecret: s.hasSecret,
    last4: s.last4,
    lastVerifiedAt: s.lastVerifiedAt?.toISOString() ?? null,
    lastError: s.lastError,
    config: s.config,
    connectedByName: s.connectedByName,
  }));
  const progress: SetupProgressView = {
    steps,
    connectedCount: state.connectedCount,
    totalCount: state.totalCount,
    attention: state.attention,
    completedAt: state.completedAt?.toISOString() ?? null,
    nextStep: state.nextStep,
    allDecided: state.allDecided,
  };

  // ?step= wins, then the first thing still worth doing, then the end.
  const requested = typeof sp.step === "string" ? sp.step : null;
  const finishActive = requested === "finish" || (!requested && state.nextStep === null);
  const activeId =
    requested && isSetupStepId(requested)
      ? requested
      : finishActive
        ? null
        : (state.nextStep ?? SETUP_STEPS[0].id);
  const active = activeId ? steps.find((s) => s.id === activeId)! : null;
  // "Change the credential" reopens the form for a step that is connected.
  const editing = sp.edit === "1";

  // The first chart. Outside the transaction above: getReport opens its own
  // service transaction (it may be revalidated with no request context).
  let attendance: AttendanceReport | null = null;
  const showChart =
    active?.id === "data" && active.status === "connected" && summary.counts.checkIns > 0;
  if (showChart) {
    const tier = reportTier(role);
    if (tier) {
      const settings = await withOrgTx(organization.id, ({ db }) =>
        db.orgSettings.findUnique({
          where: { organizationId: organization.id },
          select: { reportsDataVersion: true, reportsRefreshSeconds: true, updatedAt: true },
        }),
      );
      const result = await getReport(
        "attendance",
        {
          orgId: organization.id,
          tier,
          from: null,
          to: null,
          tz: organization.timezone || "UTC",
          dataVersion: settings?.reportsDataVersion ?? 0,
          settingsStamp: settings?.updatedAt ? settings.updatedAt.toISOString() : "",
        },
        clampRefreshSeconds(settings?.reportsRefreshSeconds),
      ).catch(() => null);
      attendance = result?.data ?? null;
    }
  }

  const progressLabel = `${state.connectedCount} of ${state.totalCount} connected${
    state.attention.length > 0
      ? ` · ${state.attention.length} need${state.attention.length === 1 ? "s" : ""} attention`
      : ""
  }`;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Set up {organization.name}</h1>
          <p className="text-muted-foreground max-w-xl text-sm">
            Four connections, one at a time. About {SETUP_TOTAL_MINUTES} minutes end to end if you
            have the credentials in front of you — and you can stop after any step and pick it up
            later.
          </p>
        </div>
        <Link
          href={`/app/${orgSlug}/setup/status`}
          className="text-sm underline-offset-4 hover:underline"
        >
          Connection status
        </Link>
      </header>

      <div className="max-w-md">
        <ProgressBar done={state.connectedCount} total={state.totalCount} label={progressLabel} />
      </div>

      <div className="grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
        <SetupSpine orgSlug={orgSlug} steps={steps} active={activeId} finishActive={finishActive} />

        {/* Not <main>: the app shell already owns the main landmark. */}
        <div className="max-w-2xl min-w-0">
          {active === null ? (
            <FinishPanel
              orgId={organization.id}
              orgSlug={orgSlug}
              orgName={organization.name}
              progress={progress}
              summary={summary}
            />
          ) : active.status === "connected" && !editing ? (
            <ResultPanel
              orgId={organization.id}
              orgSlug={orgSlug}
              view={active}
              summary={summary}
              attendance={attendance}
              editHref={`/app/${orgSlug}/setup?step=${active.id}&edit=1`}
            />
          ) : (
            <StepPanel
              orgId={organization.id}
              orgSlug={orgSlug}
              orgName={organization.name}
              view={active}
              nextStep={state.todo.find((id) => id !== active.id) ?? null}
              googleConfigured={isGoogleConfigured()}
            />
          )}
        </div>
      </div>
    </div>
  );
}
