import {
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  Database,
  Lock,
  Upload,
  UserPlus,
  Users,
  Vote,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { SyncPanel } from "@/components/databases/sync-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { fmtDateTime } from "@/server/databases/format";
import { listDatabases } from "@/server/databases/views";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { loadSetupState } from "@/server/setup/progress";
import { loadSyncStatus } from "@/server/sync/status";
import { cn } from "@/lib/utils";
import { PinToggle } from "@/components/pins/pins-context";
import { listPins } from "@/server/pins";

import { StepPanel } from "../setup/step-panel";
import type { SetupStepView } from "../setup/view";

const ICONS: Record<string, LucideIcon> = {
  CalendarDays,
  ClipboardCheck,
  UserPlus,
  Vote,
  Users,
};

const DESCRIPTIONS: Record<string, string> = {
  SESSIONS: "Your meetings and events: the same ones as the calendar.",
  ATTENDANCE: "Every check-in: who came to which session, and their total for the term.",
  SIGNUPS: "Your interest or sign-up form: who signed up and whether they came.",
  BALLOTS: "Poll results, and individual votes where your role may see them.",
  PEOPLE: "One row per person per term: how often they came, and who stopped coming.",
};

const VISIBILITY_COPY: Record<string, string> = {
  MEMBERS: "All members",
  ADMINS: "Owners and admins",
  OWNER: "Owners only",
  HIDDEN: "Hidden from members",
};

/** The Databases index: the databases this viewer may open (Settings > Privacy decides). */
export default async function DatabasesPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/databases">) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const { organization, role, user } = await getOrgContextBySlug(orgSlug);
  const isAdmin = can({ role }, "databases.write");
  const canConnect = can({ role }, "integrations.write");

  const { databases, counts, sync, dataStep, pinned } = await withOrgTx(organization.id, async ({ db }) => {
    const list = await listDatabases(db, organization.id, role);
    const counts: Record<string, number> = {};
    for (const d of list) {
      if (d.kind === "SESSIONS") {
        counts[d.key] = await db.event.count({
          where: { organizationId: organization.id, deletedAt: null, mergedIntoId: null },
        });
      } else if (d.kind === "ATTENDANCE") {
        counts[d.key] = await db.attendance.count({
          where: { organizationId: organization.id, suppressedAt: null },
        });
      } else if (d.kind === "SIGNUPS") {
        counts[d.key] = await db.signup.count({
          where: { organizationId: organization.id, suppressedAt: null },
        });
      } else if (d.kind === "PEOPLE") {
        counts[d.key] = await db.contact.count({
          where: { organizationId: organization.id, sessionsAttended: { gt: 0 } },
        });
      } else if (d.kind === "BALLOTS") {
        counts[d.key] = await db.ballotDefinition.count({
          where: { organizationId: organization.id, isTest: false },
        });
      }
    }
    const sync = isAdmin ? await loadSyncStatus(db, organization.id) : null;
    const setup = canConnect ? await loadSetupState(db, organization.id) : null;
    const data = setup?.steps.find((s) => s.step.id === "data") ?? null;
    const dataStep: SetupStepView | null = data
      ? {
          id: data.step.id,
          status: data.status,
          hasSecret: data.hasSecret,
          last4: data.last4,
          lastVerifiedAt: data.lastVerifiedAt?.toISOString() ?? null,
          lastError: data.lastError,
          config: data.config,
          connectedByName: data.connectedByName,
        }
      : null;
    const pins = await listPins(db, organization.id, organization.slug, user.id);
    return { databases: list, counts, sync, dataStep, pinned: new Set(pins.map((p) => p.href)) };
  });

  const withData = databases.filter((d) => (counts[d.key] ?? 0) > 0);
  const empty = databases.filter((d) => (counts[d.key] ?? 0) === 0);
  const connected = dataStep?.status === "connected";
  const showAll = sp.all === "1";
  const connecting = sp.connect === "1";
  // Nothing to show and nothing connected: set up the data here, instead of
  // a wall of empty databases.
  const needsSetup = withData.length === 0 && !connected && !showAll;
  const importable = databases.filter((d) => d.kind === "ATTENDANCE" || d.kind === "SIGNUPS");

  const card = (d: (typeof databases)[number], muted = false) => {
    const Icon = (d.icon && ICONS[d.icon]) || Database;
    const unit = d.kind === "BALLOTS" ? "polls" : d.kind === "PEOPLE" ? "people" : "rows";
    const href = `/app/${orgSlug}/databases/${d.key}`;
    return (
      <li key={d.id} className="group relative">
        <PinToggle
          href={href}
          label={d.name}
          className={cn(
            "absolute right-3 bottom-3 z-10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
            pinned.has(href) && "opacity-100",
          )}
        />
        <Link
          href={href}
          className={cn(
            "hover:bg-muted/50 focus-visible:ring-ring flex h-full flex-col gap-2 rounded-xl border p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none",
            muted && "border-dashed",
          )}
        >
          <span className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2.5 font-medium">
              <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
              {d.name}
            </span>
            {d.memberVisibility !== "MEMBERS" && (
              <Badge variant="outline" className="gap-1">
                <Lock className="size-3" aria-hidden="true" />
                {VISIBILITY_COPY[d.memberVisibility]}
              </Badge>
            )}
          </span>
          <span className="text-muted-foreground text-sm">{DESCRIPTIONS[d.kind] ?? ""}</span>
          <span className={cn("text-sm tabular-nums", muted && "text-muted-foreground")}>
            {muted ? "Empty" : `${(counts[d.key] ?? 0).toLocaleString()} ${unit}`}
          </span>
        </Link>
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Databases</h1>
        <p className="text-muted-foreground text-sm">
          {organization.name}&apos;s data: your events, check-ins, sign-ups and poll results.
        </p>
      </div>

      {databases.length === 0 ? (
        <EmptyState
          title="No databases are visible to you"
          description="Your club's owners decide who sees which data, in Settings › Privacy."
        />
      ) : needsSetup && !isAdmin ? (
        <EmptyState
          title="No data yet"
          description="When your club's admins connect a data source or import a spreadsheet, it shows up here."
        />
      ) : needsSetup ? (
        <section aria-labelledby="db-setup" className="space-y-4">
          <div className="space-y-1">
            <h2 id="db-setup" className="heading text-lg">
              Add your club&apos;s data
            </h2>
            <p className="text-muted-foreground text-sm">
              Nothing has been added yet. Use any of these, or more than one; you can change it
              later.
            </p>
          </div>

          <ul className="divide-y rounded-xl border">
            <li className={cn("flex flex-wrap items-center gap-x-6 gap-y-3 p-4", connecting && "bg-muted/40")}>
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="font-medium">Connect a website database</p>
                <p className="text-muted-foreground text-sm">
                  Your club site keeps check-ins, sign-ups and votes in Supabase. Connect it once;
                  it syncs every few minutes.
                </p>
              </div>
              <Button asChild size="sm" variant={connecting ? "default" : "outline"}>
                <Link
                  href={`/app/${orgSlug}/databases?connect=1#connect`}
                  scroll={false}
                  aria-current={connecting ? "step" : undefined}
                >
                  Connect
                </Link>
              </Button>
            </li>
            <li className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="font-medium">Import a spreadsheet</p>
                <p className="text-muted-foreground text-sm">
                  Have a sign-in sheet or interest form export? Bring in a CSV.
                </p>
              </div>
              <span className="flex flex-wrap gap-2">
                {importable.map((d) => (
                  <Button key={d.id} asChild size="sm" variant="outline">
                    <Link href={`/app/${orgSlug}/databases/${d.key}/import`}>
                      <Upload className="size-3.5" aria-hidden="true" />
                      {d.name}
                    </Link>
                  </Button>
                ))}
              </span>
            </li>
            <li className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="font-medium">Start from the calendar</p>
                <p className="text-muted-foreground text-sm">
                  No website? Every event you add to the calendar becomes a session here, ready
                  for check-ins.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link href={`/app/${orgSlug}/calendar`}>Open the calendar</Link>
              </Button>
            </li>
          </ul>

          {connecting && dataStep && (
            <div id="connect" className="scroll-mt-20 rounded-xl border p-5">
              <StepPanel
                orgId={organization.id}
                orgSlug={orgSlug}
                orgName={organization.name}
                view={dataStep}
                nextStep={null}
                googleConfigured={false}
                embedded
              />
            </div>
          )}
          {connecting && !dataStep && (
            <p className="text-muted-foreground text-sm">
              Only owners and admins can connect a data source.
            </p>
          )}

          <p className="text-muted-foreground text-sm">
            <Link
              href={`/app/${orgSlug}/databases?all=1`}
              className="underline underline-offset-2"
            >
              Show the empty databases anyway
            </Link>
          </p>
        </section>
      ) : (
        <>
          {withData.length > 0 && <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{withData.map((d) => card(d))}</ul>}
          {empty.length > 0 &&
            (withData.length === 0 || showAll ? (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{empty.map((d) => card(d, true))}</ul>
            ) : (
              <details className="group rounded-xl border border-dashed">
                <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm">
                  <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden="true" />
                  {empty.length} empty database{empty.length === 1 ? "" : "s"}:{" "}
                  {empty.map((d) => d.name).join(", ")}
                </summary>
                <ul className="grid gap-3 p-4 pt-0 sm:grid-cols-2 lg:grid-cols-3">{empty.map((d) => card(d, true))}</ul>
              </details>
            ))}
        </>
      )}

      {isAdmin && sync && (
        <SyncPanel
          organizationId={organization.id}
          status={sync.status}
          lastError={sync.lastError}
          endpoint={sync.endpoint}
          configError={sync.configError}
          settingsHref={`/app/${orgSlug}/settings/integrations`}
          streams={sync.streams.map((s) => ({
            stream: s.stream,
            label: s.label,
            lastSynced: s.lastSyncedAt ? fmtDateTime(s.lastSyncedAt, organization.timezone) : null,
            rowsUpserted: s.rowsUpserted,
            lastError: s.lastError,
            detail: s.detail,
          }))}
        />
      )}
      {isAdmin && !sync && !needsSetup && canConnect && (
        <p className="text-muted-foreground rounded-lg border p-4 text-sm">
          Keep check-ins, sign-ups and votes in a website database?{" "}
          <Link
            className="underline underline-offset-2"
            href={`/app/${orgSlug}/databases?connect=1&all=1#connect`}
          >
            Connect it here
          </Link>{" "}
          and it syncs by itself.
        </p>
      )}
      {showAll && connecting && dataStep && !needsSetup && (
        <div id="connect" className="scroll-mt-20 rounded-xl border p-5">
          <StepPanel
            orgId={organization.id}
            orgSlug={orgSlug}
            orgName={organization.name}
            view={dataStep}
            nextStep={null}
            googleConfigured={false}
            embedded
          />
        </div>
      )}
    </div>
  );
}
