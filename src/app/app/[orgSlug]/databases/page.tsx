import {
  CalendarDays,
  ClipboardCheck,
  Database,
  Globe,
  Handshake,
  Lightbulb,
  Lock,
  Package,
  Plus,
  Sheet,
  Shirt,
  Table2,
  Upload,
  UserPlus,
  Users,
  Vote,
  type IconComponent,
} from "@/components/icons";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { DatabaseFileImport } from "@/components/databases/custom/database-file-import";
import { NewDatabaseDialog } from "@/components/databases/custom/new-database-dialog";
import { SyncPanel } from "@/components/databases/sync-panel";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { can } from "@/lib/auth/permissions";
import { isPersonalSpace, spaceIncludes } from "@/lib/billing/space";
import { sectionLabel } from "@/lib/nav/sidebar";
import { fmtDateTime } from "@/server/databases/format";
import { listDatabases } from "@/server/databases/views";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { loadSetupState } from "@/server/setup/progress";
import { loadSyncStatus } from "@/server/sync/status";
import { reportTier } from "@/server/reports/tier";
import { cn } from "@/lib/utils";
import { PinToggle } from "@/components/pins/pins-context";
import { listPins } from "@/server/pins";
import { planGate } from "@/server/billing/plan-gate";

import { StepPanel } from "../setup/step-panel";
import type { SetupStepView } from "../setup/view";
import { DatabasesTabs } from "./databases-tabs";

const ICONS: Record<string, IconComponent> = {
  CalendarDays,
  ClipboardCheck,
  UserPlus,
  Vote,
  Users,
  Table2,
  Sheet,
  Package,
  Shirt,
  Handshake,
  Lightbulb,
};

/**
 * The 36px icon chip (ui/stat's IconChip, size sm), drawn here: IconChip is
 * a client component, and a server page can't hand it an icon component.
 */
function IconChip({ icon: Icon, className }: { icon: IconComponent; className?: string }) {
  return (
    <span
      className={cn(
        "bg-card ring-foreground/6 grid size-9 shrink-0 place-items-center rounded-full shadow-[var(--edge-highlight)] ring-1",
        className,
      )}
    >
      <Icon className="size-[18px]" aria-hidden="true" />
    </span>
  );
}

/** The database cards: 18px apart, three across on a wide screen. */
const GRID = "grid gap-4.5 sm:grid-cols-2 lg:grid-cols-3";

const VISIBILITY_COPY: Record<string, string> = {
  MEMBERS: "All members",
  ADMINS: "Owners and admins",
  OWNER: "Owners only",
  HIDDEN: "Hidden from members",
};

/**
 * The Databases index: the databases this viewer may open (Settings > Privacy
 * decides). In Personal, only the ones its owner makes: no built-in club
 * data, data source or reports.
 */
export default async function DatabasesPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/databases">) {
  const { orgSlug } = await params;
  const planLock = await planGate(orgSlug, "databases");
  if (planLock) return planLock;
  const sp = await searchParams;
  const { organization, role, user, settings } = await getOrgContextBySlug(orgSlug);
  const personal = isPersonalSpace(organization);
  const isAdmin = can({ role }, "databases.write");
  // A data source fills a club's built-in databases; Personal Plus's data
  // connection is for calendar sync.
  const connections = !personal && spaceIncludes(organization, "integrations");
  const canConnect = connections && can({ role }, "integrations.write");
  const showReports =
    spaceIncludes(organization, "reports") &&
    Boolean(reportTier(role)) &&
    can({ role }, "reports.view");

  const { databases, counts, sync, dataStep, pinned } = await withOrgTx(
    organization.id,
    async ({ db }) => {
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
        } else if (d.kind === "CUSTOM") {
          counts[d.key] = await db.databaseRecord.count({
            where: { organizationId: organization.id, databaseId: d.id, deletedAt: null },
          });
        }
      }
      const sync = isAdmin && connections ? await loadSyncStatus(db, organization.id) : null;
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
    },
  );

  const custom = databases.filter((d) => d.kind === "CUSTOM");
  const builtIns = databases.filter((d) => d.kind !== "CUSTOM");
  const withData = builtIns.filter((d) => (counts[d.key] ?? 0) > 0);
  const empty = builtIns.filter((d) => (counts[d.key] ?? 0) === 0);
  const connected = dataStep?.status === "connected";
  const showAll = sp.all === "1";
  const connecting = sp.connect === "1";
  // Nothing made, nothing added: how to start, instead of a wall of empty
  // databases. The club's data is stored here either way.
  const needsSetup = withData.length === 0 && custom.length === 0 && !connected && !showAll;
  const importable = databases.filter((d) => d.kind === "ATTENDANCE" || d.kind === "SIGNUPS");

  // Where each database's rows come from: the website's Supabase for the
  // streams a connected sync fills, Bananasplit for everything else. Only
  // admins can read the connection, so only they see the tag.
  const SYNCED_KIND: Record<string, string> = {
    checkins: "ATTENDANCE",
    signups: "SIGNUPS",
    sessions: "SESSIONS",
    ballots: "BALLOTS",
  };
  const syncedKinds = new Set(
    connected && sync ? sync.streams.map((st) => SYNCED_KIND[st.stream]).filter(Boolean) : [],
  );
  const sourceOf = (d: (typeof databases)[number]) =>
    syncedKinds.has(d.kind) ? "Supabase" : "Bananasplit";

  const unitOf = (d: (typeof databases)[number], n: number) => {
    const unit = d.kind === "BALLOTS" ? "polls" : d.kind === "PEOPLE" ? "people" : "rows";
    return n === 1 ? (unit === "people" ? "person" : unit.replace(/s$/, "")) : unit;
  };

  const card = (d: (typeof databases)[number], muted = false) => {
    const Icon = (d.icon && ICONS[d.icon]) || Database;
    const count = counts[d.key] ?? 0;
    const href = `/app/${orgSlug}/databases/${d.key}`;
    return (
      <li key={d.id} className="group relative">
        <PinToggle
          href={href}
          label={d.name}
          className={cn(
            "absolute right-5 bottom-5 z-10 size-8 rounded-full opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100",
            pinned.has(href) && "opacity-100",
          )}
        />
        <Link
          href={href}
          className={cn(
            "bg-card text-card-foreground ring-foreground/6 rounded-card flex h-full min-h-44 flex-col p-6 ring-1 outline-none",
            "focus-visible:outline-foreground transition-[transform,box-shadow] duration-200 ease-(--ease-ink) focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transform-none",
            muted ? "hover:bg-muted/40" : "edge hover:shadow-e2 hover:-translate-y-0.5",
          )}
        >
          <span className="flex items-start justify-between gap-2">
            <IconChip icon={Icon} className={cn(muted && "text-muted-foreground")} />
            <span className="flex flex-wrap justify-end gap-1.5">
              {d.memberVisibility !== "MEMBERS" && (
                <Badge variant="secondary">
                  <Lock aria-hidden="true" />
                  {VISIBILITY_COPY[d.memberVisibility]}
                </Badge>
              )}
              {isAdmin && !personal && sourceOf(d) === "Supabase" && (
                <Badge variant="secondary" title={`Stored in ${sourceOf(d)}`}>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-1.5 rounded-full",
                      sourceOf(d) === "Supabase" ? "bg-success" : "bg-glow",
                    )}
                  />
                  {sourceOf(d)}
                </Badge>
              )}
            </span>
          </span>
          <span className="heading mt-4 text-[17px]">{d.name}</span>
          <span className="text-muted-foreground mt-1 line-clamp-2 text-sm">
            {d.description ?? ""}
          </span>
          <span className="mt-auto flex items-baseline gap-1.5 pt-4">
            {muted ? (
              <span className="text-muted-foreground text-sm">Empty</span>
            ) : (
              <>
                <span className="numeral text-[23px]">{count.toLocaleString()}</span>
                <span className="text-muted-foreground text-sm">{unitOf(d, count)}</span>
              </>
            )}
          </span>
        </Link>
      </li>
    );
  };

  const setupRow = "flex flex-wrap items-center gap-x-6 gap-y-3 py-4 first:pt-0 last:pb-0";

  return (
    <div className="space-y-7.5">
      <PageHeader
        title={sectionLabel(settings?.sidebar, "databases")}
        actions={
          isAdmin && (
            <NewDatabaseDialog orgId={organization.id} orgSlug={orgSlug} personal={personal} />
          )
        }
        tabs={<DatabasesTabs orgSlug={orgSlug} showReports={showReports} />}
      />

      {databases.length === 0 && !personal ? (
        <EmptyState
          icon={Database}
          title="No databases are visible to you"
          description="Owners choose who sees each one."
        />
      ) : needsSetup && !isAdmin ? (
        <EmptyState icon={Database} title="No data yet" description="Admins add databases here." />
      ) : needsSetup ? (
        <section aria-labelledby="db-setup" className="space-y-4.5">
          <h2 id="db-setup" className="heading text-[17px]">
            {personal ? "Make your first database" : <>Add your organization&apos;s data</>}
          </h2>

          <Card>
            <CardContent>
              <ul className="divide-border/70 divide-y">
                <li className={setupRow}>
                  <IconChip icon={Table2} />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="font-semibold">Make a database</p>
                    <p className="text-muted-foreground text-sm">
                      From a template, a blank spreadsheet or a file you drop here.
                    </p>
                  </div>
                  <NewDatabaseDialog
                    orgId={organization.id}
                    orgSlug={orgSlug}
                    personal={personal}
                    trigger={
                      <Button variant="outline">
                        <Plus aria-hidden="true" />
                        New database
                      </Button>
                    }
                  />
                </li>
                {importable.length > 0 && (
                  <li className={setupRow}>
                    <IconChip icon={Upload} />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="font-semibold">Import a sign-in sheet</p>
                      <p className="text-muted-foreground text-sm">
                        Straight into{" "}
                        {importable.map((d, i) => (
                          <span key={d.id}>
                            {i > 0 && " or "}
                            <Link
                              href={`/app/${orgSlug}/databases/${d.key}/import`}
                              className="hover:text-foreground underline underline-offset-2"
                            >
                              {d.name}
                            </Link>
                          </span>
                        ))}
                        .
                      </p>
                    </div>
                  </li>
                )}
                {/* A club's built-in data: sessions from its calendar, and its website's. */}
                {!personal && (
                  <>
                    <li className={setupRow}>
                      <IconChip icon={CalendarDays} />
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="font-semibold">Start from the calendar</p>
                        <p className="text-muted-foreground text-sm">
                          Every event becomes a session, ready for check-ins.
                        </p>
                      </div>
                      <Button asChild variant="outline">
                        <Link href={`/app/${orgSlug}/calendar`}>Open the calendar</Link>
                      </Button>
                    </li>
                    <li className={setupRow}>
                      <IconChip icon={Globe} />
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="font-semibold">Website database</p>
                        <p className="text-muted-foreground text-sm">
                          Sync check-ins, sign-ups and votes from Supabase.
                        </p>
                      </div>
                      <Button asChild variant={connecting ? "secondary" : "ghost"}>
                        <Link
                          href={`/app/${orgSlug}/databases?connect=1#connect`}
                          scroll={false}
                          aria-current={connecting ? "step" : undefined}
                        >
                          Connect
                        </Link>
                      </Button>
                    </li>
                  </>
                )}
              </ul>
            </CardContent>
          </Card>

          {connecting && dataStep && (
            <Card id="connect" className="scroll-mt-20">
              <CardContent>
                <StepPanel
                  orgId={organization.id}
                  orgSlug={orgSlug}
                  view={dataStep}
                  nextStep={null}
                  googleConfigured={false}
                  embedded
                />
              </CardContent>
            </Card>
          )}
          {connecting && !dataStep && !personal && (
            <p className="text-muted-foreground text-sm">
              Only owners and admins can connect a data source.
            </p>
          )}

          {!personal && (
            <p className="text-muted-foreground text-sm">
              <Link
                href={`/app/${orgSlug}/databases?all=1`}
                className="underline underline-offset-2"
              >
                Show empty databases
              </Link>
            </p>
          )}
        </section>
      ) : (
        <>
          {/*
            One list: the organization's own databases and the built-in ones together,
            each tagged with where its rows live (Bananasplit or the website's
            Supabase). Empty built-ins fold away under the list.
          */}
          <section aria-labelledby="db-all" className="space-y-4">
            <h2 id="db-all" className="sr-only">
              Databases
            </h2>
            <ul className={GRID}>
              {custom.map((d) => card(d))}
              {withData.map((d) => card(d))}
            </ul>
            {/* The empty ones, quieter, after the rest: one click to open, nothing to unfold. */}
            {empty.length > 0 && <ul className={GRID}>{empty.map((d) => card(d, true))}</ul>}
          </section>
        </>
      )}

      {isAdmin && (
        <DatabaseFileImport
          orgId={organization.id}
          orgSlug={orgSlug}
          personal={personal}
          fromFile={typeof sp.fromFile === "string" ? sp.fromFile : null}
        />
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
      {/* Admins only (databases.write and integrations.write); hidden while the connect panel below is open. */}
      {isAdmin && !sync && !needsSetup && canConnect && !(showAll && connecting && dataStep) && (
        <p className="text-muted-foreground text-sm">
          Website database?{" "}
          <Link
            className="hover:text-foreground underline underline-offset-2"
            href={`/app/${orgSlug}/databases?connect=1&all=1#connect`}
          >
            Connect it
          </Link>
        </p>
      )}
      {showAll && connecting && dataStep && !needsSetup && (
        <Card id="connect" className="scroll-mt-20">
          <CardContent>
            <StepPanel
              orgId={organization.id}
              orgSlug={orgSlug}
              view={dataStep}
              nextStep={null}
              googleConfigured={false}
              embedded
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
