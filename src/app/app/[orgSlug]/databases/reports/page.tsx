import { ChartNoAxesColumn, Globe, History, Lock, Plus } from "@/components/icons";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RangePicker } from "@/components/reports/range-picker";
import { ReportsFrame } from "@/components/reports/reports-frame";
import { CreateSuggestedButton } from "@/components/reports/saved/create-suggested-button";
import { ReportIcon } from "@/components/reports/saved/icons";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { WIDGETS, suggestedWidgets } from "@/lib/reports/catalog";
import { cn } from "@/lib/utils";
import { planGate } from "@/server/billing/plan-gate";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { rangeQuery, resolveReportRange } from "@/server/reports/range";
import { reportViewer } from "@/server/reports/run";
import { listReports, listSnapshots } from "@/server/reports/saved";
import { listSources } from "@/server/reports/sources";
import { reportTier } from "@/server/reports/tier";

import { DatabasesTabs } from "../databases-tabs";

export const metadata = { title: "Reports" };

const CARD =
  "bg-card text-card-foreground ring-foreground/6 rounded-card edge flex h-full flex-col p-6 ring-1 outline-none transition-[transform,box-shadow] duration-200 ease-(--ease-ink) hover:shadow-e2 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground motion-reduce:transform-none";

function Chip({ icon }: { icon: string }) {
  return (
    <span className="bg-card ring-foreground/6 grid size-9 shrink-0 place-items-center rounded-full shadow-[var(--edge-highlight)] ring-1">
      <ReportIcon name={icon} className="size-[18px]" />
    </span>
  );
}

/** "Overdue and stale", "RSVPs and check-ins" mid-sentence. */
function lowerFirst(title: string): string {
  return /^[A-Z][a-z]/.test(title) ? title[0].toLowerCase() + title.slice(1) : title;
}

function rowCount(s: { rows: number; kind: string }): string {
  const unit =
    s.kind === "people"
      ? ["member", "members"]
      : s.kind === "events"
        ? ["event", "events"]
        : ["row", "rows"];
  return `${s.rows.toLocaleString("en-US")} ${s.rows === 1 ? unit[0] : unit[1]}`;
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Reports home: the organization's saved reports (each one database and a
 * board of widgets on it), a one-click report for every database that has
 * none yet, and the past reports people kept. The date pills sit beside the
 * Databases and Reports tabs, as Tasks' do; the range they pick goes with
 * every report opened from here. New report starts the walkthrough.
 */
export default async function ReportsPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/databases/reports">) {
  const { orgSlug } = await params;
  const planLock = await planGate(orgSlug, "reports");
  if (planLock) return planLock;
  const sp = await searchParams;
  const { organization, role, user } = await getOrgContextBySlug(orgSlug);
  if (!reportTier(role) || !can({ role }, "reports.view")) notFound();
  const tz = organization.timezone || "UTC";
  const range = resolveReportRange(sp, tz);
  const keep = new URLSearchParams(rangeQuery(range)).toString();
  const withRange = (href: string) => (keep ? `${href}?${keep}` : href);
  const isAdmin = can({ role }, "databases.write");

  const { reports, sources, snapshots } = await withOrgTx(organization.id, async (ctx) => {
    const v = await reportViewer({
      db: ctx.db,
      organizationId: organization.id,
      userId: user.id,
      role,
    });
    return {
      reports: await listReports(ctx.db, organization.id),
      sources: await listSources(v),
      snapshots: await listSnapshots(ctx.db, organization.id),
    };
  });
  const sourceBy = new Map(sources.map((s) => [s.key, s]));
  const reported = new Set(reports.map((r) => r.source));
  // Empty ones wait until they have rows: a report on nothing reads nothing.
  const unreported = sources.filter((s) => !reported.has(s.key) && s.rows > 0);
  const base = `/app/${orgSlug}/databases/reports`;

  return (
    <ReportsFrame>
      <div className="space-y-7.5">
        <PageHeader
          title="Reports"
          description={
            reports.length
              ? `${reports.length} report${reports.length === 1 ? "" : "s"}. Times in ${tz}`
              : `Times in ${tz}`
          }
          actions={
            <Button asChild variant="create">
              <Link href={`${base}/new`}>
                <Plus aria-hidden="true" />
                New report
              </Link>
            </Button>
          }
          tabs={
            <div className="flex flex-wrap items-center justify-between gap-3">
              <DatabasesTabs orgSlug={orgSlug} showReports />
              <RangePicker
                preset={range.preset}
                from={range.from}
                to={range.to}
                label={range.label}
                span={range.span}
              />
            </div>
          }
        />

        {reports.length > 0 && (
          <section aria-labelledby="your-reports" className="space-y-4">
            <h2 id="your-reports" className="heading text-[17px]">
              Your reports
            </h2>
            <ul className="grid gap-4.5 sm:grid-cols-2 lg:grid-cols-3">
              {reports.map((r) => {
                const source = sourceBy.get(r.source);
                const lead = r.insights?.lines[0]?.text;
                return (
                  <li key={r.id}>
                    <Link href={withRange(`${base}/${r.id}`)} className={cn(CARD, "min-h-48")}>
                      <span className="flex items-start justify-between gap-2">
                        <Chip icon={source?.icon ?? "Database"} />
                        <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                          {r.access === "PRIVATE" ? (
                            <>
                              <Lock className="size-3.5" aria-hidden="true" /> Only you
                            </>
                          ) : (
                            <>
                              <Globe className="size-3.5" aria-hidden="true" /> Shared
                            </>
                          )}
                        </span>
                      </span>
                      <span className="heading mt-4 text-[17px]">{r.title}</span>
                      <span className="text-muted-foreground mt-1 text-sm">
                        {source?.name ?? "A database you can't see"}, {r.widgets.length} widget
                        {r.widgets.length === 1 ? "" : "s"}
                      </span>
                      {lead && <span className="mt-3 line-clamp-2 text-sm">{lead}</span>}
                      <span className="text-muted-foreground mt-auto pt-4 text-xs">
                        Changed {day(r.updatedAt)}
                        {r.createdById !== user.id && r.createdByName
                          ? ` by ${r.createdByName}`
                          : ""}
                        {r.snapshots
                          ? `. ${r.snapshots} past report${r.snapshots === 1 ? "" : "s"}`
                          : ""}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {sources.length === 0 ? (
          <EmptyState
            icon={ChartNoAxesColumn}
            title="Nothing to report on yet"
            description="Make a database, or add tasks or expenses, and reports can read it."
          />
        ) : (
          unreported.length > 0 && (
            <section aria-labelledby="start-report" className="space-y-4">
              <div className="space-y-1">
                <h2 id="start-report" className="heading text-[17px]">
                  {reports.length
                    ? "Databases with no report yet"
                    : "Start with a report on any database"}
                </h2>
                <p className="text-muted-foreground text-sm">
                  Make it in one click with the widgets that suit it, or choose your own.
                </p>
              </div>
              <ul className="grid gap-4.5 sm:grid-cols-2 lg:grid-cols-3">
                {unreported.map((s) => {
                  const picks = suggestedWidgets(s, isAdmin).filter((t) => t !== "insights");
                  return (
                    <li key={s.key} className="bg-muted/45 rounded-card flex flex-col gap-3 p-5">
                      <span className="flex items-center gap-3">
                        <Chip icon={s.icon} />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{s.name}</span>
                          <span className="text-muted-foreground block text-xs">{rowCount(s)}</span>
                        </span>
                      </span>
                      <span className="text-muted-foreground text-sm">
                        Insights, {picks.map((t) => lowerFirst(WIDGETS[t].title)).join(", ")}
                      </span>
                      <span className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                        <CreateSuggestedButton
                          orgId={organization.id}
                          orgSlug={orgSlug}
                          sourceKey={s.key}
                          name={s.name}
                        />
                        <Button asChild size="sm" variant="ghost">
                          <Link href={`${base}/new?source=${encodeURIComponent(s.key)}`}>
                            Choose widgets
                          </Link>
                        </Button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )
        )}

        {snapshots.length > 0 && (
          <section aria-labelledby="past-reports" className="space-y-4">
            <div className="space-y-1">
              <h2 id="past-reports" className="heading text-[17px]">
                Past reports
              </h2>
              <p className="text-muted-foreground text-sm">
                Reports as they read when someone kept them.
              </p>
            </div>
            <ul className="bg-card ring-foreground/6 rounded-card edge divide-border divide-y ring-1">
              {snapshots.slice(0, 12).map((s) => (
                <li key={s.id}>
                  <Link
                    href={`${base}/${s.reportId}/past/${s.id}`}
                    className="hover:bg-muted/40 focus-glow flex items-center gap-3 px-5 py-3.5 outline-none first:rounded-t-[inherit] last:rounded-b-[inherit]"
                  >
                    <History className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate font-medium">{s.reportTitle}</span>
                    <span className="text-muted-foreground hidden text-sm sm:inline">
                      {s.rangeLabel}
                    </span>
                    <span className="text-muted-foreground text-sm tabular-nums">
                      {day(s.takenAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </ReportsFrame>
  );
}
