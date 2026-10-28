import { AlertTriangle, Clock, Plug } from "@/components/icons";
import Link from "next/link";

import { SyncPanel } from "@/components/databases/sync-panel";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge, StepMarker } from "@/components/setup/setup-ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { can } from "@/lib/auth/permissions";
import { fmtDateTime } from "@/server/databases/format";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { setupStep } from "@/server/setup/catalog";
import { diagnose } from "@/server/setup/diagnose";
import { loadSetupState, needsAttention, type SetupStepState } from "@/server/setup/progress";
import { loadDataSummary } from "@/server/setup/summary";
import { planGate } from "@/server/billing/plan-gate";

import { TestButton } from "../step-controls";
import { DisconnectButton } from "./status-rows";

/**
 * Connection status (OWNER/ADMIN): every service, whether it works, when it
 * was last proved, when its data last arrived, and — for anything broken —
 * what the service said and the one thing to change.
 *
 * Everything on this page is read live from the integration rows and the
 * sync state, so it cannot disagree with reality. Nothing is cached.
 */

export const dynamic = "force-dynamic";

/** Data older than this, on a connected source, is behind its hourly schedule. */
const SYNC_STALE_MS = 2 * 60 * 60 * 1000;
/** A working credential nobody has re-proved in this long is worth a nudge. */
const VERIFY_STALE_MS = 60 * 24 * 60 * 60 * 1000;

function staleNote(s: SetupStepState, syncedAt: Date | null, now: Date, tz: string): string | null {
  if (s.status !== "connected") return null;
  if (s.step.id === "data") {
    if (!syncedAt)
      return "Connected, but no data has arrived yet. Run a sync to fill the databases.";
    if (now.getTime() - syncedAt.getTime() > SYNC_STALE_MS) {
      return `The last sync finished ${fmtDateTime(syncedAt, tz)}, which is behind the hourly schedule. Sync now, or check whether the job runner is running.`;
    }
    return null;
  }
  if (s.lastVerifiedAt && now.getTime() - s.lastVerifiedAt.getTime() > VERIFY_STALE_MS) {
    return `Last proved ${fmtDateTime(s.lastVerifiedAt, tz)}. Keys get revoked quietly — a test takes a second.`;
  }
  return null;
}

export default async function SetupStatusPage({
  params,
}: PageProps<"/app/[orgSlug]/setup/status">) {
  const { orgSlug } = await params;
  const planLock = await planGate(orgSlug, "integrations");
  if (planLock) return planLock;
  const { organization, role } = await getOrgContextBySlug(orgSlug);

  if (!can({ role }, "integrations.view")) {
    return (
      <div className="mx-auto max-w-lg py-10">
        <EmptyState
          icon={Plug}
          title="Connection status is for owners and admins"
          description="It shows credentials and the errors services return, so it is limited to owners and admins."
          action={
            <Button asChild variant="outline">
              <Link href={`/app/${orgSlug}`}>Back to the overview</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const canWrite = can({ role }, "integrations.write");
  const canRemove = can({ role }, "integrations.remove");
  const tz = organization.timezone || "UTC";
  const now = new Date();

  const { state, summary } = await withOrgTx(organization.id, async ({ db }) => ({
    state: await loadSetupState(db, organization.id),
    summary: await loadDataSummary(db, organization.id, role, organization.slug),
  }));

  const broken = state.steps.filter((s) => needsAttention(s.status));
  const stale = state.steps
    .map((s) => ({ s, note: staleNote(s, summary.syncedAt, now, tz) }))
    .filter((x): x is { s: SetupStepState; note: string } => x.note !== null);

  const summaryLine = [
    `${state.connectedCount} of ${state.totalCount} connected`,
    broken.length > 0 ? `${broken.length} not working` : null,
    stale.length > 0 ? `${stale.length} behind` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="max-w-3xl space-y-7.5">
      <div className="space-y-3">
        <PageHeader
          title="Connection status"
          description={summaryLine}
          actions={
            <Button asChild variant="outline">
              <Link href={`/app/${orgSlug}/setup`}>Connect tools</Link>
            </Button>
          }
        />
        <p className="text-muted-foreground max-w-prose text-sm">
          What {organization.name} is connected to, and what to do when one of them stops.
        </p>
      </div>

      {broken.length > 0 ? (
        <section
          aria-labelledby="needs-attention"
          className="bg-tint-danger text-tint-danger-foreground rounded-card space-y-4 p-5 sm:p-6"
        >
          <h2 id="needs-attention" className="heading flex items-center gap-2 text-[15px]">
            <AlertTriangle className="size-4" aria-hidden="true" />
            {broken.length} {broken.length === 1 ? "connection is" : "connections are"} not working
          </h2>
          <ul className="space-y-4">
            {broken.map((s) => {
              const d = s.lastError ? diagnose(s.step.id, s.lastError) : null;
              return (
                <li key={s.step.id} className="space-y-2">
                  <p className="text-sm font-semibold">{s.step.title}</p>
                  {d ? <p className="text-sm">{d.reason}</p> : null}
                  {d?.fix ? <p className="text-sm opacity-85">{d.fix}</p> : null}
                  <div className="flex flex-wrap items-center gap-3">
                    <Button asChild size="sm">
                      <Link href={`/app/${orgSlug}/setup?step=${s.step.id}&edit=1`}>
                        Fix {s.step.title}
                      </Link>
                    </Button>
                    {canWrite ? <TestButton orgId={organization.id} step={s.step.id} /> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {stale.length > 0 ? (
        <section aria-labelledby="stale" className="bg-muted/60 rounded-tile space-y-2 p-4">
          <h2 id="stale" className="heading flex items-center gap-2 text-[15px]">
            <Clock className="text-warning size-4" aria-hidden="true" />
            Working, but behind
          </h2>
          <ul className="space-y-1.5">
            {stale.map(({ s, note }) => (
              <li key={s.step.id} className="text-sm">
                <span className="font-semibold">{s.step.title}:</span> {note}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Card aria-label="Connections" role="region" className="gap-0 px-3 py-3">
        <ul className="divide-border/70 divide-y">
          {state.steps.map((s, i) => {
            const step = setupStep(s.step.id);
            return (
              <li key={s.step.id} className="space-y-3 px-3 py-4">
                <div className="flex flex-wrap items-start gap-3">
                  <StepMarker status={s.status} ordinal={i + 1} active={false} />
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="text-sm font-semibold">{step.title}</p>
                    <p className="text-muted-foreground mt-0.5 text-[13px]">{step.summary}</p>
                  </div>
                  <StatusBadge status={s.status} className="mt-0.5" />
                </div>

                <dl className="text-muted-foreground grid gap-x-6 gap-y-1 pl-10 text-[13px] sm:grid-cols-[9rem_1fr]">
                  <dt>Credential</dt>
                  <dd
                    className={
                      s.hasSecret && s.last4 ? "text-foreground font-mono" : "text-foreground"
                    }
                  >
                    {s.hasSecret ? (s.last4 ? `•••• ${s.last4}` : "Saved") : "None stored"}
                  </dd>
                  <dt>Last checked</dt>
                  <dd className="text-foreground">
                    {s.lastVerifiedAt ? fmtDateTime(s.lastVerifiedAt, tz) : "Never"}
                  </dd>
                  {s.step.id === "data" ? (
                    <>
                      <dt>Last sync</dt>
                      <dd className="text-foreground">
                        {summary.syncing
                          ? "Running now"
                          : summary.syncedAt
                            ? fmtDateTime(summary.syncedAt, tz)
                            : "Never"}
                      </dd>
                      {summary.sync?.endpoint ? (
                        <>
                          <dt>Reads from</dt>
                          <dd className="text-foreground font-mono break-all">
                            {summary.sync.endpoint}
                          </dd>
                        </>
                      ) : null}
                    </>
                  ) : null}
                  {s.connectedByName ? (
                    <>
                      <dt>Set up by</dt>
                      <dd className="text-foreground">{s.connectedByName}</dd>
                    </>
                  ) : null}
                  {s.lastError && s.status !== "connected" ? (
                    <>
                      <dt>Last error</dt>
                      <dd className="text-destructive">{s.lastError}</dd>
                    </>
                  ) : null}
                </dl>

                {canWrite ? (
                  <div className="flex flex-wrap items-center gap-2 pl-10">
                    {s.hasSecret ? (
                      <TestButton
                        orgId={organization.id}
                        step={s.step.id}
                        label={
                          s.step.id === "calendar"
                            ? "Test and refresh calendars"
                            : "Test connection"
                        }
                      />
                    ) : null}
                    <Button asChild variant="ghost">
                      <Link
                        href={`/app/${orgSlug}/setup?step=${s.step.id}${s.hasSecret ? "&edit=1" : ""}`}
                      >
                        {s.hasSecret ? "Reconnect" : "Set up"}
                      </Link>
                    </Button>
                    {s.hasSecret ? (
                      <DisconnectButton
                        orgId={organization.id}
                        step={s.step.id}
                        canRemove={canRemove}
                      />
                    ) : null}
                    <Link
                      href={`/app/${orgSlug}/settings/integrations/${step.settingsSegment}`}
                      className="text-muted-foreground hover:text-foreground focus-glow ml-auto self-center rounded-full text-[13px] font-medium underline-offset-4 hover:underline"
                    >
                      Settings
                    </Link>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>

      {summary.sync ? (
        <SyncPanel
          organizationId={organization.id}
          status={summary.sync.status}
          lastError={summary.sync.lastError}
          endpoint={summary.sync.endpoint}
          configError={summary.sync.configError}
          settingsHref={`/app/${orgSlug}/settings/integrations/data-source`}
          streams={summary.sync.streams.map((s) => ({
            stream: s.stream,
            label: s.label,
            lastSynced: s.lastSyncedAt ? fmtDateTime(s.lastSyncedAt, tz) : null,
            rowsUpserted: s.rowsUpserted,
            lastError: s.lastError,
            detail: s.detail,
          }))}
        />
      ) : null}
    </div>
  );
}
