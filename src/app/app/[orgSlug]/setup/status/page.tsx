import { AlertTriangle, Clock, Lock } from "lucide-react";
import Link from "next/link";

import { SyncPanel } from "@/components/databases/sync-panel";
import { EmptyState } from "@/components/empty-state";
import { ProgressBar, StatusWord, StepMarker } from "@/components/setup/setup-ui";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { fmtDateTime } from "@/server/databases/format";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { setupStep } from "@/server/setup/catalog";
import { diagnose } from "@/server/setup/diagnose";
import { loadSetupState, needsAttention, type SetupStepState } from "@/server/setup/progress";
import { loadDataSummary } from "@/server/setup/summary";

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
  const { organization, role } = await getOrgContextBySlug(orgSlug);

  if (!can({ role }, "integrations.view")) {
    return (
      <div className="mx-auto max-w-lg py-10">
        <EmptyState
          icon={Lock}
          title="Connection status is for owners and admins"
          description="It shows credentials and the errors services return, so it is limited to owners and admins."
          action={
            <Link href={`/app/${orgSlug}`} className="text-sm underline underline-offset-4">
              Back to the overview
            </Link>
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

  return (
    <div className="max-w-3xl space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0 space-y-1">
          <h1 className="page-title">Connection status</h1>
          <p className="text-muted-foreground text-sm">
            What {organization.name} is connected to, and what to do when one of them stops.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/app/${orgSlug}/setup`}>Guided setup</Link>
        </Button>
      </header>

      <div className="max-w-md">
        <ProgressBar
          done={state.connectedCount}
          total={state.totalCount}
          label={`${state.connectedCount} of ${state.totalCount} connected`}
        />
      </div>

      {broken.length > 0 ? (
        <section
          aria-labelledby="needs-attention"
          className="border-destructive/40 bg-destructive/5 space-y-4 rounded-lg border p-4"
        >
          <h2
            id="needs-attention"
            className="text-destructive flex items-center gap-2 text-sm font-semibold"
          >
            <AlertTriangle className="size-4" aria-hidden="true" />
            {broken.length} {broken.length === 1 ? "connection is" : "connections are"} not working
          </h2>
          <ul className="space-y-4">
            {broken.map((s) => {
              const d = s.lastError ? diagnose(s.step.id, s.lastError) : null;
              return (
                <li key={s.step.id} className="space-y-2">
                  <p className="text-sm font-medium">{s.step.title}</p>
                  {d ? <p className="text-sm">{d.reason}</p> : null}
                  {d?.fix ? <p className="text-muted-foreground text-sm">{d.fix}</p> : null}
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
        <section
          aria-labelledby="stale"
          className="border-warning/40 bg-warning/10 space-y-2 rounded-lg border p-4"
        >
          <h2 id="stale" className="flex items-center gap-2 text-sm font-semibold">
            <Clock className="size-4" aria-hidden="true" />
            Working, but behind
          </h2>
          <ul className="space-y-1.5">
            {stale.map(({ s, note }) => (
              <li key={s.step.id} className="text-sm">
                <span className="font-medium">{s.step.title}:</span> {note}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label="Connections">
        <ul className="divide-y rounded-lg border">
          {state.steps.map((s, i) => {
            const step = setupStep(s.step.id);
            return (
              <li key={s.step.id} className="space-y-3 p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <StepMarker status={s.status} ordinal={i + 1} active={false} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{step.title}</p>
                    <p className="text-muted-foreground text-xs">{step.summary}</p>
                  </div>
                  <StatusWord status={s.status} className="mt-1" />
                </div>

                <dl className="text-muted-foreground grid gap-x-6 gap-y-1 pl-9 text-xs sm:grid-cols-[9rem_1fr]">
                  <dt>Credential</dt>
                  <dd className="text-foreground font-mono">
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
                  <div className="flex flex-wrap items-center gap-2 pl-9">
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
                      className="text-muted-foreground ml-auto self-center text-xs underline-offset-4 hover:underline"
                    >
                      Settings
                    </Link>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

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
