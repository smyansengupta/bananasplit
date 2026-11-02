import { ChartNoAxesColumn, Plus, Sparkles } from "@/components/icons";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RangePicker } from "@/components/reports/range-picker";
import { ReportsBody, ReportsFrame } from "@/components/reports/reports-frame";
import { AskReports } from "@/components/reports/saved/ask-reports";
import { CreateSuggestedButton } from "@/components/reports/saved/create-suggested-button";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { WIDGETS, suggestedWidgets } from "@/lib/reports/catalog";
import { formatValue, type ComputedWidget, type InsightLine } from "@/lib/reports/compute";
import { scheduleTag } from "@/lib/reports/schedule";
import { cn } from "@/lib/utils";
import { listAiConnections } from "@/server/ai/connections";
import { planGate } from "@/server/billing/plan-gate";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { rangeQuery, resolveReportRange } from "@/server/reports/range";
import { builtInInsights, loadBuiltInReports, reportViewer, runReport } from "@/server/reports/run";
import { listReports } from "@/server/reports/saved";
import { listSources } from "@/server/reports/sources";
import { reportTier } from "@/server/reports/tier";

import { DatabasesTabs } from "../databases-tabs";

export const metadata = { title: "Reports" };

/** Reports read on the home page: the most recently changed. */
const HOME_REPORTS = 9;

const CARD =
  "bg-card text-card-foreground ring-foreground/6 rounded-card edge flex h-full flex-col gap-2.5 p-5 ring-1 outline-none transition-[transform,box-shadow] duration-200 ease-(--ease-ink) hover:shadow-e2 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground motion-reduce:transform-none";

const TONE_DOT: Record<InsightLine["tone"], string> = {
  warn: "bg-[var(--chart-2)]",
  good: "bg-[var(--chart-3)]",
  info: "bg-[var(--chart-1)]",
};

function lowerFirst(title: string): string {
  return /^[A-Z][a-z]/.test(title) ? title[0].toLowerCase() + title.slice(1) : title;
}

/** A report card's headline: its first number, else its goal, else what's overdue. */
function headline(
  computed: ComputedWidget[],
): { value: string; delta: number | null; sub: string | null } | null {
  const number = computed.find((c) => c.payload?.type === "number");
  const goal = computed.find((c) => c.payload?.type === "goal");
  const overdue = computed.find((c) => c.payload?.type === "overdue");
  const goalSub =
    goal?.payload?.type === "goal" && goal.payload.data.target
      ? `${goal.payload.data.pct}% of ${formatValue(goal.payload.data.target, goal.payload.data.format)}`
      : null;
  const overdueSub =
    overdue?.payload?.type === "overdue" && overdue.payload.data.overdueCount > 0
      ? `${overdue.payload.data.overdueCount} overdue`
      : null;
  if (number?.payload?.type === "number") {
    const d = number.payload.data;
    return {
      value: formatValue(d.value, d.format),
      delta: d.deltaPct,
      sub: goalSub ?? overdueSub ?? lowerFirst(number.title),
    };
  }
  if (goal?.payload?.type === "goal") {
    const d = goal.payload.data;
    return { value: formatValue(d.value, d.format), delta: null, sub: goalSub };
  }
  if (overdue?.payload?.type === "overdue") {
    return { value: String(overdue.payload.data.overdueCount), delta: null, sub: "overdue" };
  }
  return null;
}

/**
 * Reports home: what your reports say together (each one's leading line,
 * the slipping ones first, and a box to ask Claude about them), the
 * reports themselves with their headline numbers, and a one-click report
 * for every database that has rows and none yet. The date pills sit beside
 * the Databases and Reports tabs, as Tasks' do, and every number here and
 * in a report opened from here follows them. Past reports lists the copies
 * kept and the reports on a schedule.
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

  const { reports, sources } = await withOrgTx(organization.id, async (ctx) => {
    const v = await reportViewer({
      db: ctx.db,
      organizationId: organization.id,
      userId: user.id,
      role,
    });
    const all = await listReports(ctx.db, organization.id);
    const read = [];
    for (const report of all.slice(0, HOME_REPORTS)) {
      read.push({ report, run: await runReport(v, report, sp) });
    }
    return { reports: read, sources: await listSources(v) };
  });
  const aiReady = reports.length > 0 && (await listAiConnections(organization.id)).length > 0;
  // An Events report's cards are the built-in reports: read them for its line and headline.
  const settings = await withOrgTx(organization.id, ({ db }) =>
    db.orgSettings.findUnique({
      where: { organizationId: organization.id },
      select: { reportsDataVersion: true, reportsRefreshSeconds: true, updatedAt: true },
    }),
  );
  const events = new Map<string, { lines: InsightLine[]; checkIns: number | null }>();
  for (const { report, run } of reports) {
    const types = new Set(run.computed.map((c) => c.widget.type));
    if (!types.has("attendance") && !types.has("retention")) continue;
    const built = await loadBuiltInReports({
      orgId: organization.id,
      role,
      tz,
      range,
      settings,
      want: { attendance: types.has("attendance"), retention: types.has("retention") },
    });
    events.set(report.id, {
      lines: builtInInsights(built.attendance, built.retention, {}),
      checkIns: built.attendance?.totalCheckIns ?? null,
    });
  }
  const reported = new Set(reports.map((r) => r.report.source));
  // Empty ones wait until they have rows: a report on nothing reads nothing.
  const unreported = sources.filter((s) => !reported.has(s.key) && s.rows > 0);
  const base = `/app/${orgSlug}/databases/reports`;

  // Each report's leading line, the slipping ones first.
  const lines = reports
    .map(({ report, run }) => {
      const insights = run.computed.find((c) => c.payload?.type === "insights");
      const line =
        (insights?.payload?.type === "insights" ? insights.payload.data.lines[0] : null) ??
        events.get(report.id)?.lines[0] ??
        null;
      return line ? { line, report } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => (a.line.tone === "warn" ? 0 : 1) - (b.line.tone === "warn" ? 0 : 1));
  const slipping = lines.filter((l) => l.line.tone === "warn").length;
  const n = reports.length;
  const lead =
    slipping === 0
      ? `Nothing is slipping across your ${n} report${n === 1 ? "" : "s"}.`
      : `${slipping} of your ${n} report${n === 1 ? "" : "s"} ${slipping === 1 ? "has" : "have"} something slipping. Start there.`;

  return (
    <ReportsFrame>
      <div className="space-y-7.5">
        <PageHeader
          title="Reports"
          actions={
            <>
              <Button asChild variant="outline">
                <Link href={`${base}/past`}>Past reports</Link>
              </Button>
              <Button asChild variant="create">
                <Link href={`${base}/new`}>
                  <Plus aria-hidden="true" />
                  Create new report
                </Link>
              </Button>
            </>
          }
          tabs={
            <div className="flex flex-wrap items-center gap-3">
              <DatabasesTabs orgSlug={orgSlug} showReports />
              <RangePicker
                preset={range.preset}
                from={range.from}
                to={range.to}
                label={range.label}
                span={range.span}
              />
              <span className="text-muted-foreground text-[13px]">
                {range.span ? `${range.label}, ${range.span}` : range.label}. Times in {tz}
              </span>
            </div>
          }
        />

        <ReportsBody className="space-y-7.5">
          {lines.length > 0 && (
            <section
              aria-labelledby="h-insights"
              className="bg-card ring-foreground/6 rounded-card edge space-y-4.5 p-7 ring-1"
            >
              <div className="flex items-center gap-3">
                <span className="bg-primary text-primary-foreground grid size-9 place-items-center rounded-full">
                  <Sparkles className="size-[18px]" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <h2 id="h-insights" className="heading text-[19px]">
                    Insights
                  </h2>
                  <span className="text-muted-foreground text-[12.5px]">
                    Across your {n} report{n === 1 ? "" : "s"}, {range.label}
                  </span>
                </span>
              </div>
              <p className="heading max-w-[62ch] text-[22px] leading-tight tracking-tight sm:text-[24px]">
                {lead}
              </p>
              <ul className="grid gap-x-7 gap-y-3 md:grid-cols-2">
                {lines.slice(0, 6).map(({ line, report }) => (
                  <li key={report.id} className="flex items-start gap-2.5 text-sm leading-relaxed">
                    <span
                      aria-hidden="true"
                      className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", TONE_DOT[line.tone])}
                    />
                    <span>
                      {line.text}{" "}
                      <Link
                        href={withRange(`${base}/${report.id}`)}
                        className="text-muted-foreground hover:text-foreground font-semibold underline-offset-2 hover:underline"
                      >
                        {report.title}
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
              {aiReady && <AskReports orgId={organization.id} />}
            </section>
          )}

          {reports.length > 0 && (
            <section aria-labelledby="your-reports" className="space-y-3.5">
              <h2 id="your-reports" className="heading text-[17px]">
                Your reports
              </h2>
              <ul className="grid gap-4.5 sm:grid-cols-2 lg:grid-cols-3">
                {reports.map(({ report: r, run }) => {
                  const checkIns = events.get(r.id)?.checkIns ?? null;
                  const head =
                    headline(run.computed) ??
                    (checkIns !== null
                      ? { value: checkIns.toLocaleString("en-US"), delta: null, sub: "check-ins" }
                      : null);
                  const tag = r.schedule
                    ? scheduleTag(r.schedule)
                    : r.access === "PRIVATE"
                      ? "Only you"
                      : r.createdById === user.id
                        ? "You"
                        : (r.createdByName?.split(/\s+/)[0] ?? "Shared");
                  return (
                    <li key={r.id}>
                      <Link href={withRange(`${base}/${r.id}`)} className={cn(CARD, "min-h-44")}>
                        <span className="flex items-center gap-2">
                          <span className="heading min-w-0 flex-1 truncate text-[16px]">
                            {r.title}
                          </span>
                          <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold">
                            {tag}
                          </span>
                        </span>
                        <span className="text-muted-foreground text-[12.5px]">
                          {run.source?.name ?? "A database you can't see"}
                        </span>
                        {head ? (
                          <span className="mt-auto flex items-end gap-2 pt-2">
                            <span className="numeral text-[30px] leading-none">{head.value}</span>
                            {head.delta !== null && Math.abs(head.delta) >= 1 && (
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
                                  head.delta > 0
                                    ? "bg-tint-success text-tint-success-foreground"
                                    : "bg-tint-danger text-tint-danger-foreground",
                                )}
                              >
                                {head.delta > 0 ? "+" : ""}
                                {Math.round(head.delta)}%
                              </span>
                            )}
                            {head.sub && (
                              <span className="text-muted-foreground ms-auto mb-0.5 truncate text-xs">
                                {head.sub}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground mt-auto pt-2 text-xs">
                            {r.widgets.length} widget{r.widgets.length === 1 ? "" : "s"}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
                <li>
                  <Link
                    href={`${base}/new`}
                    className="rounded-card border-border hover:bg-muted/40 focus-glow flex h-full min-h-44 flex-col items-start justify-center gap-2 border-[1.5px] border-dashed p-5 outline-none"
                  >
                    <span className="bg-muted grid size-9 place-items-center rounded-full">
                      <Plus className="size-4" aria-hidden="true" />
                    </span>
                    <b>Create new report</b>
                    <span className="text-muted-foreground text-[12.5px]">
                      Pick a database, then its widgets
                    </span>
                  </Link>
                </li>
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
              <section aria-labelledby="start-report" className="space-y-3.5">
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <h2 id="start-report" className="heading text-[17px]">
                    {reports.length
                      ? "Databases with no report yet"
                      : "Start with a report on any database"}
                  </h2>
                  <span className="text-muted-foreground text-[13.5px]">
                    Each comes with widgets already picked
                  </span>
                </div>
                <ul className="grid gap-4.5 sm:grid-cols-2 lg:grid-cols-3">
                  {unreported.map((s) => {
                    const picks = suggestedWidgets(s, isAdmin).filter((t) => t !== "insights");
                    return (
                      <li
                        key={s.key}
                        className="bg-card ring-foreground/6 rounded-card edge flex flex-col gap-2.5 p-5 ring-1"
                      >
                        <b>{s.name}</b>
                        <span className="text-muted-foreground text-[13px]">
                          {picks.length
                            ? [
                                WIDGETS[picks[0]].title,
                                ...picks.slice(1, 4).map((t) => lowerFirst(WIDGETS[t].title)),
                              ].join(", ")
                            : "Insights"}
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
        </ReportsBody>
      </div>
    </ReportsFrame>
  );
}
