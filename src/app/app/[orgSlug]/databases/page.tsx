import {
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  Database,
  FileSpreadsheet,
  Globe,
  Handshake,
  Lightbulb,
  Lock,
  Package,
  Plus,
  Sheet,
  ShieldCheck,
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

const DESCRIPTIONS: Record<string, string> = {
  SESSIONS: "Your meetings and events: the same ones as the calendar.",
  ATTENDANCE: "Every check-in: who came to which session, and their total for the term.",
  SIGNUPS: "Your interest or sign-up form: who signed up and whether they came.",
  BALLOTS: "Poll results, and individual votes where your role may see them.",
  PEOPLE: "One row per person per term: how often they came, and who stopped coming.",
  CUSTOM: "A database your organization made.",
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
              {isAdmin && !personal && (
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
            {d.description ?? DESCRIPTIONS[d.kind] ?? ""}
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

  // The live summary under the title: what's here, from the counts above.
  // Polls aren't rows (a poll's rows are its ballots), so they're said apart.
  const rowTotal = databases
    .filter((d) => d.kind !== "BALLOTS")
    .reduce((sum, d) => sum + (counts[d.key] ?? 0), 0);
  const polls = databases
    .filter((d) => d.kind === "BALLOTS")
    .reduce((sum, d) => sum + (counts[d.key] ?? 0), 0);
  const summary =
    databases.length === 0
      ? "None visible to you"
      : [
          `${databases.length.toLocaleString()} ${databases.length === 1 ? "database" : "databases"}`,
          rowTotal === 0
            ? "no rows yet"
            : `${rowTotal.toLocaleString()} ${rowTotal === 1 ? "row" : "rows"}`,
          polls > 0 && `${polls.toLocaleString()} ${polls === 1 ? "poll" : "polls"}`,
        ]
          .filter(Boolean)
          .join(" · ");

  const setupRow = "flex flex-wrap items-center gap-x-6 gap-y-3 py-4 first:pt-0 last:pb-0";

  return (
    <div className="space-y-7.5">
      <PageHeader
        title={sectionLabel(settings?.sidebar, "databases")}
        description={summary}
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
          description="Your organization's owners decide who sees which data, in Admin panel › Privacy."
        />
      ) : needsSetup && !isAdmin ? (
        <EmptyState
          icon={Database}
          title="No data yet"
          description="When your organization's admins make a database or import a spreadsheet, it shows up here."
        />
      ) : needsSetup ? (
        <section aria-labelledby="db-setup" className="space-y-4.5">
          <div className="space-y-1.5">
            <h2 id="db-setup" className="heading text-[17px]">
              {personal ? "Make your first database" : <>Add your organization&apos;s data</>}
            </h2>
            <p className="text-muted-foreground flex items-start gap-2 text-sm">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {personal ? (
                <>
                  Everything is stored in Bananasplit and saved as you type: there&apos;s no
                  database to set up, and only you can see them.
                </>
              ) : (
                <>
                  Everything is stored in Bananasplit and saved as you type: there&apos;s no
                  database to set up, and no other organization can see your data.
                </>
              )}
            </p>
          </div>

          <Card>
            <CardContent>
              <ul className="divide-border/70 divide-y">
                <li className={setupRow}>
                  <IconChip icon={Table2} />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="font-semibold">Make a database</p>
                    <p className="text-muted-foreground text-sm">
                      {personal
                        ? "A reading list, your classes, job applications, anything you keep track of: start blank and add the fields you choose."
                        : "A member roster, equipment, merch orders, sponsors: start from a template or from scratch, with the fields you choose."}
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
                <li className={setupRow}>
                  <IconChip icon={Sheet} />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="font-semibold">Start a spreadsheet</p>
                    <p className="text-muted-foreground text-sm">
                      A blank grid of rows and columns to type straight into. Rename the columns, or
                      turn one into numbers, dates or choices, whenever you like.
                    </p>
                  </div>
                  <NewDatabaseDialog
                    orgId={organization.id}
                    orgSlug={orgSlug}
                    personal={personal}
                    defaultTemplateId="spreadsheet"
                    trigger={
                      <Button variant="outline">
                        <Sheet aria-hidden="true" />
                        New spreadsheet
                      </Button>
                    }
                  />
                </li>
                <li className={setupRow}>
                  <IconChip icon={Upload} />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="font-semibold">Import a spreadsheet</p>
                    <p className="text-muted-foreground text-sm">
                      Bring in an Excel workbook (.xlsx), a CSV or a TSV, from Excel, Google Sheets
                      or Numbers; it becomes a database with a field per column.{" "}
                      {importable.length > 0 && (
                        <>
                          Sign-in sheets and interest forms can go straight into{" "}
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
                        </>
                      )}
                    </p>
                  </div>
                  <NewDatabaseDialog
                    orgId={organization.id}
                    orgSlug={orgSlug}
                    personal={personal}
                    defaultMode="import"
                    trigger={
                      <Button variant="outline">
                        <Upload aria-hidden="true" />
                        Import a spreadsheet
                      </Button>
                    }
                  />
                </li>
                {/* A club's built-in data: sessions from its calendar, and its website's. */}
                {!personal && (
                  <>
                    <li className={setupRow}>
                      <IconChip icon={CalendarDays} />
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="font-semibold">Start from the calendar</p>
                        <p className="text-muted-foreground text-sm">
                          No website? Every event you add to the calendar becomes a session here,
                          ready for check-ins.
                        </p>
                      </div>
                      <Button asChild variant="outline">
                        <Link href={`/app/${orgSlug}/calendar`}>Open the calendar</Link>
                      </Button>
                    </li>
                    <li className={setupRow}>
                      <IconChip icon={Globe} />
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="font-semibold">
                          Already have a website database?{" "}
                          <span className="text-muted-foreground font-normal">Optional</span>
                        </p>
                        <p className="text-muted-foreground text-sm">
                          If your site keeps check-ins, sign-ups and votes in Supabase, connect it
                          and they sync in. You don&apos;t need one to use Databases.
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
                Show the empty databases anyway
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
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="db-all" className="sr-only">
                Databases
              </h2>
              <span className="text-muted-foreground flex items-center gap-1.5 text-[13px]">
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                Saved as you type. Only {personal ? "you" : "your organization"} can see them.
              </span>
            </div>
            <ul className={GRID}>
              {custom.map((d) => card(d))}
              {withData.map((d) => card(d))}
              {isAdmin && (
                <li>
                  <NewDatabaseDialog
                    orgId={organization.id}
                    orgSlug={orgSlug}
                    personal={personal}
                    trigger={
                      <button
                        type="button"
                        className="text-muted-foreground hover:bg-muted/40 hover:text-foreground border-border rounded-card focus-visible:outline-foreground flex h-full min-h-44 w-full flex-col items-start justify-center gap-3 border-[1.5px] border-dashed p-6 text-left transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
                      >
                        <span className="border-input grid size-9 place-items-center rounded-full border-[1.5px] border-dashed">
                          <Plus className="size-[18px]" aria-hidden="true" />
                        </span>
                        <span className="space-y-1">
                          <span className="text-foreground heading block text-[15px]">
                            New database
                          </span>
                          <span className="flex items-center gap-1.5 text-[13px]">
                            <FileSpreadsheet className="size-3.5" aria-hidden="true" />
                            From a template or a spreadsheet
                          </span>
                        </span>
                      </button>
                    }
                  />
                </li>
              )}
            </ul>
            {empty.length > 0 &&
              (withData.length === 0 || showAll ? (
                <ul className={GRID}>{empty.map((d) => card(d, true))}</ul>
              ) : (
                <details className="group">
                  <summary className="text-muted-foreground hover:text-foreground bg-muted/60 rounded-tile focus-visible:outline-foreground flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm outline-none focus-visible:outline-2 [&::-webkit-details-marker]:hidden">
                    <ChevronRight
                      className="size-4 transition-transform group-open:rotate-90"
                      aria-hidden="true"
                    />
                    {empty.length} empty database{empty.length === 1 ? "" : "s"}:{" "}
                    {empty.map((d) => d.name).join(", ")}
                  </summary>
                  <ul className={cn(GRID, "pt-4.5")}>{empty.map((d) => card(d, true))}</ul>
                </details>
              ))}
          </section>
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
      {/* Admins only (databases.write and integrations.write); hidden while the connect panel below is open. */}
      {isAdmin && !sync && !needsSetup && canConnect && !(showAll && connecting && dataStep) && (
        <p className="text-muted-foreground text-sm">
          Keep check-ins, sign-ups and votes in a website database?{" "}
          <Link
            className="hover:text-foreground underline underline-offset-2"
            href={`/app/${orgSlug}/databases?connect=1&all=1#connect`}
          >
            Connect it
          </Link>{" "}
          and it syncs by itself.
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
