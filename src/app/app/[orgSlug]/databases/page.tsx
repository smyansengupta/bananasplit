import {
  CalendarDays,
  Database,
  Globe,
  Plus,
  Table2,
  Upload,
  type IconComponent,
} from "@/components/icons";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { DatabaseFileImport } from "@/components/databases/custom/database-file-import";
import { NewDatabaseDialog } from "@/components/databases/custom/new-database-dialog";
import { SyncPanel } from "@/components/databases/sync-panel";
import { PageHeader } from "@/components/page-header";
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

import { DatabasesHome, type WeekNote } from "@/components/databases/databases-home";
import { displayText } from "@/lib/databases/fields";
import { scheduleTag } from "@/lib/reports/schedule";
import { loadFields } from "@/server/databases/custom";
import {
  weeklyExpenses,
  weeklyRowsFor,
  weeklyTasks,
  type WeeklyRows,
} from "@/server/databases/home";
import { listReports } from "@/server/reports/saved";

import { StepPanel } from "../setup/step-panel";
import type { SetupStepView } from "../setup/view";
import { DatabasesTabs } from "./databases-tabs";

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

/** The report source of a built-in database. */
const BUILT_IN_SOURCE: Partial<Record<string, string>> = {
  SESSIONS: "events",
  ATTENDANCE: "events",
  PEOPLE: "people",
};

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

  const { databases, counts, sync, dataStep, pinned, home } = await withOrgTx(
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
      // Databases home: how each one grew, its newest row, and the reports.
      const weekly: Record<string, WeeklyRows> = {};
      const latest: Record<string, string | null> = {};
      for (const d of list) {
        weekly[d.key] = await weeklyRowsFor(db, organization.id, d);
        if (d.kind === "CUSTOM") {
          const fields = await loadFields(db, organization.id, d.id);
          const primary = fields.find((f) => f.isPrimary) ?? fields[0];
          const row = await db.databaseRecord.findFirst({
            where: { organizationId: organization.id, databaseId: d.id, deletedAt: null },
            orderBy: { createdAt: "desc" },
            select: { values: true },
          });
          const values = (row?.values ?? {}) as Record<string, unknown>;
          latest[d.key] =
            primary && row ? displayText(primary, values[primary.id], new Map()) || null : null;
        }
      }
      const tasks = spaceIncludes(organization, "tasks")
        ? {
            weekly: await weeklyTasks(db, organization.id),
            open: await db.task.count({
              where: {
                organizationId: organization.id,
                deletedAt: null,
                type: { not: "EPIC" },
                status: { not: "COMPLETED" },
              },
            }),
            overdue: await db.task.count({
              where: {
                organizationId: organization.id,
                deletedAt: null,
                type: { not: "EPIC" },
                status: { not: "COMPLETED" },
                dueDate: { lt: new Date() },
              },
            }),
            total: await db.task.count({
              where: { organizationId: organization.id, deletedAt: null, type: { not: "EPIC" } },
            }),
          }
        : null;
      const expenses =
        spaceIncludes(organization, "finance") && can({ role }, "finance.manage")
          ? {
              weekly: await weeklyExpenses(db, organization.id),
              total: await db.transaction.count({
                where: { organizationId: organization.id, direction: "OUT", voidedAt: null },
              }),
              spentCents:
                (
                  await db.transaction.aggregate({
                    where: { organizationId: organization.id, direction: "OUT", voidedAt: null },
                    _sum: { amountCents: true },
                  })
                )._sum.amountCents ?? 0,
            }
          : null;
      const reports = showReports ? await listReports(db, organization.id) : null;
      return {
        databases: list,
        counts,
        sync,
        dataStep,
        pinned: new Set(pins.map((p) => p.href)),
        home: { weekly, latest, tasks, expenses, reports },
      };
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

  const setupRow = "flex flex-wrap items-center gap-x-6 gap-y-3 py-4 first:pt-0 last:pb-0";

  // Databases home: which report reads each database, and what changed this week.
  const reportFor = (key: string) => {
    const r = home.reports?.find((x) => x.source === key);
    return r ? { title: r.title, href: `/app/${orgSlug}/databases/reports/${r.id}` } : null;
  };
  const newReport = (key: string) =>
    showReports ? `/app/${orgSlug}/databases/reports/new?source=${encodeURIComponent(key)}` : null;
  const reportable = [
    ...custom.map((d) => `custom:${d.id}`),
    ...(home.tasks ? ["tasks"] : []),
    ...(home.expenses ? ["expenses"] : []),
  ];
  const sourceName = (key: string) =>
    key === "tasks"
      ? "Tasks"
      : key === "expenses"
        ? "Expenses"
        : key === "events"
          ? "Events and attendance"
          : key === "people"
            ? "People"
            : (databases.find((d) => `custom:${d.id}` === key)?.name ?? "A database");
  const weekRows = [
    ...databases.map((d) => ({
      name: d.name,
      key: d.key,
      ...(home.weekly[d.key] ?? { weeks: [], thisWeek: 0 }),
    })),
    ...(home.tasks ? [{ name: "Tasks", key: "tasks", ...home.tasks.weekly }] : []),
    ...(home.expenses ? [{ name: "Expenses", key: "expenses", ...home.expenses.weekly }] : []),
  ];
  const hrefOf = (key: string) =>
    key === "tasks"
      ? `/app/${orgSlug}/tasks`
      : key === "expenses"
        ? `/app/${orgSlug}/finance/transactions`
        : `/app/${orgSlug}/databases/${key}`;
  const notes: WeekNote[] = [
    ...(home.tasks && home.tasks.overdue > 0
      ? [
          {
            tag: String(home.tasks.overdue),
            tone: "warn" as const,
            text: `task${home.tasks.overdue === 1 ? "" : "s"} past due`,
            where: "Tasks",
            href: `/app/${orgSlug}/tasks`,
          },
        ]
      : []),
    ...weekRows
      .filter((r) => r.thisWeek > 0)
      .sort((a, b) => b.thisWeek - a.thisWeek)
      .slice(0, 4)
      .map((r) => ({
        tag: `+${r.thisWeek}`,
        tone: "good" as const,
        text:
          r.key === "tasks"
            ? "tasks filed"
            : r.key === "expenses"
              ? "expenses logged"
              : "rows added",
        where: r.name,
        href: hrefOf(r.key),
      })),
  ];
  const money = (cents: number) =>
    (cents / 100).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
  const builtInRows = [
    ...(home.expenses
      ? [
          {
            key: "expenses",
            name: "Expenses",
            detail: `From Finance. ${money(home.expenses.spentCents)} spent`,
            href: hrefOf("expenses"),
            count: home.expenses.total,
            thisWeek: home.expenses.weekly.thisWeek,
            report: reportFor("expenses"),
            newReportHref: newReport("expenses"),
          },
        ]
      : []),
    ...(home.tasks
      ? [
          {
            key: "tasks",
            name: "Tasks",
            detail: `${home.tasks.open} open, ${home.tasks.overdue} overdue`,
            href: hrefOf("tasks"),
            count: home.tasks.total,
            thisWeek: home.tasks.weekly.thisWeek,
            report: reportFor("tasks"),
            newReportHref: newReport("tasks"),
          },
        ]
      : []),
    ...[...withData, ...(showAll ? empty : [])].map((d) => {
      const source = BUILT_IN_SOURCE[d.kind] ?? null;
      const n = counts[d.key] ?? 0;
      return {
        key: d.key,
        name: d.name,
        detail: `${d.description ?? `${n.toLocaleString("en-US")} ${unitOf(d, n)}`}${
          isAdmin && !personal && sourceOf(d) === "Supabase" ? ". Synced from Supabase" : ""
        }`,
        href: hrefOf(d.key),
        count: n,
        thisWeek: home.weekly[d.key]?.thisWeek ?? 0,
        report: source ? reportFor(source) : null,
        newReportHref: source ? newReport(source) : null,
      };
    }),
  ];

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
          <DatabasesHome
            stats={{
              databases: databases.length,
              addedThisWeek: weekRows.reduce((a, b) => a + b.thisWeek, 0),
              across: weekRows.filter((r) => r.thisWeek > 0).length,
              reports: home.reports ? home.reports.length : null,
              withoutReport: reportable.filter((key) => !reportFor(key)).length,
              empty: custom.filter((d) => (counts[d.key] ?? 0) === 0).length + empty.length,
            }}
            custom={custom.map((d) => {
              const href = `/app/${orgSlug}/databases/${d.key}`;
              const n = counts[d.key] ?? 0;
              return {
                id: d.id,
                name: d.name,
                icon: d.icon,
                href,
                count: n,
                unit: n === 1 ? "row" : "rows",
                weeks: home.weekly[d.key]?.weeks ?? [],
                thisWeek: home.weekly[d.key]?.thisWeek ?? 0,
                latest: home.latest[d.key] ?? null,
                restricted:
                  d.memberVisibility !== "MEMBERS" ? VISIBILITY_COPY[d.memberVisibility] : null,
                report: reportFor(`custom:${d.id}`),
                newReportHref: newReport(`custom:${d.id}`),
                pin: (
                  <PinToggle
                    href={href}
                    label={d.name}
                    className={cn(
                      "size-8 rounded-full opacity-0 group-hover/db:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100",
                      pinned.has(href) && "opacity-100",
                    )}
                  />
                ),
              };
            })}
            builtIn={builtInRows}
            notes={notes}
            reports={
              home.reports
                ? home.reports.slice(0, 4).map((r) => ({
                    title: r.title,
                    sub: [sourceName(r.source), r.schedule ? scheduleTag(r.schedule) : null]
                      .filter(Boolean)
                      .join(", "),
                    href: `/app/${orgSlug}/databases/reports/${r.id}`,
                  }))
                : null
            }
            newDatabase={
              isAdmin ? (
                <NewDatabaseDialog
                  orgId={organization.id}
                  orgSlug={orgSlug}
                  personal={personal}
                  trigger={
                    <button
                      type="button"
                      className="rounded-card border-border hover:bg-muted/40 focus-glow flex h-full min-h-48 w-full flex-col items-start justify-center gap-2 border-[1.5px] border-dashed p-5 text-left outline-none"
                    >
                      <span className="bg-muted grid size-9 place-items-center rounded-full">
                        <Plus className="size-4" aria-hidden="true" />
                      </span>
                      <b>New database</b>
                      <span className="text-muted-foreground text-[13px]">
                        Start empty, from a sheet, or from a template.
                      </span>
                    </button>
                  }
                />
              ) : null
            }
            newReportHref={showReports ? `/app/${orgSlug}/databases/reports/new` : null}
            reportsHref={showReports ? `/app/${orgSlug}/databases/reports` : null}
          />
          {empty.length > 0 && !showAll && (
            <p className="text-muted-foreground text-sm">
              <Link
                href={`/app/${orgSlug}/databases?all=1`}
                className="underline underline-offset-2"
              >
                Show {empty.length} empty built-in database{empty.length === 1 ? "" : "s"}
              </Link>
            </p>
          )}
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
          settingsHref={`/app/${orgSlug}/integrations`}
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
