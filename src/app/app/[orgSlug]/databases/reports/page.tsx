import { ChartNoAxesColumn, Plus } from "@/components/icons";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RangePicker } from "@/components/reports/range-picker";
import { ReportsBody, ReportsFrame } from "@/components/reports/reports-frame";
import { AskReports } from "@/components/reports/saved/ask-reports";
import { InsightsCard } from "@/components/reports/saved/insights-card";
import { CreateSuggestedButton } from "@/components/reports/saved/create-suggested-button";
import { ReportIcon } from "@/components/reports/saved/icons";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { WIDGETS, suggestedWidgets, type SourceKind } from "@/lib/reports/catalog";
import { readyKindsFor } from "@/lib/reports/crm-ready";
import {
  formatValue,
  spanPhrase,
  type ComputedWidget,
  type InsightLine,
} from "@/lib/reports/compute";
import { scheduleTag } from "@/lib/reports/schedule";
import { cn } from "@/lib/utils";
import { planGate } from "@/server/billing/plan-gate";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { rangeQuery, resolveReportRange } from "@/server/reports/range";
import { builtInInsights, loadBuiltInReports, reportViewer, runReport } from "@/server/reports/run";
import { missingReadyReports } from "@/server/reports/ready";
import { listReports } from "@/server/reports/saved";
import { listSources } from "@/server/reports/sources";
import { reportTier } from "@/server/reports/tier";

import { DatabasesTabs } from "../databases-tabs";

export const metadata = { title: "Reports" };

/** Reports whose numbers the home page reads (the most recently changed); the rest are listed plainly. */
const HOME_REPORTS = 12;

const TONE_DOT: Record<InsightLine["tone"], string> = {
  warn: "bg-[var(--chart-2)]",
  good: "bg-[var(--chart-3)]",
  info: "bg-[var(--chart-1)]",
};

const KIND_TINT: Record<SourceKind, string> = {
  custom: "bg-tint-success text-tint-success-foreground",
  tasks: "bg-tint-info text-tint-info-foreground",
  expenses: "bg-tint-accent text-tint-accent-foreground",
  events: "bg-tint-danger text-tint-danger-foreground",
  people: "bg-tint-info text-tint-info-foreground",
};

function lowerFirst(title: string): string {
  return /^[A-Z][a-z]/.test(title) ? title[0].toLowerCase() + title.slice(1) : title;
}

interface Headline {
  value: string;
  label: string;
  delta: number | null;
  /** Its trend, oldest first, for the card's line. */
  trend: number[];
}

/** A report card's headline: its first number, else its over-time total, else its goal. */
function headline(computed: ComputedWidget[]): Headline | null {
  for (const c of computed) {
    const p = c.payload;
    if (p?.type === "number") {
      return {
        value: formatValue(p.data.value, p.data.format),
        label: c.title,
        delta: p.data.deltaPct,
        trend: p.data.spark,
      };
    }
  }
  for (const c of computed) {
    const p = c.payload;
    if (p?.type === "over-time") {
      return {
        value: formatValue(p.data.total, p.data.format),
        label: c.title,
        delta: null,
        trend: p.data.points.map((x) => x.value),
      };
    }
    if (p?.type === "goal") {
      return {
        value: formatValue(p.data.value, p.data.format),
        label: p.data.pct !== null ? `${c.title}, ${p.data.pct}% there` : c.title,
        delta: null,
        trend: [],
      };
    }
  }
  return null;
}

/** The card's trend line, with a soft fill under it. */
function Trend({ values }: { values: number[] }) {
  if (values.length < 2 || values.every((v) => v === 0)) {
    return <div className="bg-muted/60 h-12 rounded-[10px]" aria-hidden="true" />;
  }
  const max = Math.max(1, ...values);
  const step = 200 / (values.length - 1);
  const line = values
    .map((v, i) => `${(i * step).toFixed(1)},${(46 - (v / max) * 40).toFixed(1)}`)
    .join(" ");
  return (
    <svg
      viewBox="0 0 200 48"
      preserveAspectRatio="none"
      className="h-12 w-full"
      role="img"
      aria-label={`Trend: ${values.join(", ")}`}
    >
      <polygon points={`0,48 ${line} 200,48`} fill="var(--chart-1)" opacity="0.12" />
      <polyline
        points={line}
        fill="none"
        stroke="var(--chart-1)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * Reports home. Your reports are live: open one and it reads the data as it
 * is now, over the dates the pills pick (a copy kept of one lives at the
 * bottom of that report). Above the reports, what they
 * say together, the slipping ones first, with a box to ask Claude about
 * them; below, a one-click report for each database that has rows and none.
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

  const { reports, sources, settings, ready } = await withOrgTx(organization.id, async (ctx) => {
    const v = await reportViewer({
      db: ctx.db,
      organizationId: organization.id,
      userId: user.id,
      role,
    });
    const all = await listReports(ctx.db, organization.id);
    const read = [];
    for (const [i, report] of all.entries()) {
      read.push({ report, run: i < HOME_REPORTS ? await runReport(v, report, sp) : null });
    }
    return {
      reports: read,
      sources: await listSources(v),
      ready: await missingReadyReports(v),
      settings: await ctx.db.orgSettings.findUnique({
        where: { organizationId: organization.id },
        select: { reportsDataVersion: true, reportsRefreshSeconds: true, updatedAt: true },
      }),
    };
  });

  // An Events report's cards are the built-in reports: read them for its line and headline.
  const events = new Map<string, { lines: InsightLine[]; headline: Headline | null }>();
  for (const { report, run } of reports) {
    if (!run) continue;
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
    const a = built.attendance;
    events.set(report.id, {
      lines: builtInInsights(a, built.retention, {}, spanPhrase(range)),
      headline: a
        ? {
            value: a.totalCheckIns.toLocaleString("en-US"),
            label: `Check-ins, ${a.average ?? 0} a session`,
            delta: null,
            trend: a.sessions.map((s) => s.checkIns),
          }
        : null,
    });
  }

  const sourceBy = new Map(sources.map((s) => [s.key, s]));
  const reported = new Set(reports.map((r) => r.report.source));
  // Empty ones wait until they have rows: a report on nothing reads nothing. The
  // CRM's databases have ready-made reports instead.
  const unreported = sources.filter(
    (s) => !reported.has(s.key) && s.rows > 0 && readyKindsFor(s).length === 0,
  );
  const base = `/app/${orgSlug}/databases/reports`;

  const cards = reports.map(({ report, run }) => {
    const insights = run?.computed.find((c) => c.payload?.type === "insights");
    const line =
      (insights?.payload?.type === "insights" ? insights.payload.data.lines[0] : null) ??
      events.get(report.id)?.lines[0] ??
      null;
    return {
      report,
      run,
      line,
      head: (run && headline(run.computed)) ?? events.get(report.id)?.headline ?? null,
    };
  });
  const lines = cards
    .filter((c): c is typeof c & { line: InsightLine } => c.line !== null)
    .sort((a, b) => (a.line.tone === "warn" ? 0 : 1) - (b.line.tone === "warn" ? 0 : 1));
  const slipping = lines.filter((l) => l.line.tone === "warn").length;
  // Only the reports whose numbers were read count toward what the lead says.
  const n = reports.filter((r) => r.run).length;
  const lead =
    slipping === 0
      ? `Nothing is slipping across your ${n} report${n === 1 ? "" : "s"}.`
      : `${slipping} of your ${n} report${n === 1 ? "" : "s"} ${slipping === 1 ? "has" : "have"} something slipping.`;

  return (
    <ReportsFrame>
      <div className="space-y-8">
        <PageHeader
          title="Reports"
          actions={
            <>
              <Button asChild variant="create">
                <Link href={`${base}/new`}>
                  <Plus aria-hidden="true" />
                  New report
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
            </div>
          }
        />

        <ReportsBody className="space-y-8">
          {n > 0 && (
            <section aria-label="Insights">
              <InsightsCard
                wide
                subtitle={`Across your ${n} report${n === 1 ? "" : "s"}, from their numbers`}
                lead={lead}
                lines={lines.slice(0, 6).map(({ line, report }) => ({
                  ...line,
                  label: report.title,
                  href: withRange(`${base}/${report.id}`),
                }))}
                next={lines.find((l) => l.line.next)?.line.next ?? null}
                ask={<AskReports orgId={organization.id} />}
              />
            </section>
          )}

          {reports.length > 0 && (
            <section aria-labelledby="your-reports" className="space-y-3.5">
              <div className="flex flex-wrap items-baseline gap-2.5">
                <h2 id="your-reports" className="heading text-[17px]">
                  Your reports
                </h2>
              </div>
              <ul className="grid gap-4.5 sm:grid-cols-2 xl:grid-cols-3">
                {cards.map(({ report: r, run, line, head }) => {
                  const source = sourceBy.get(r.source);
                  const tag = r.schedule
                    ? scheduleTag(r.schedule)
                    : r.access === "PRIVATE"
                      ? "Only you"
                      : null;
                  return (
                    <li key={r.id}>
                      <Link
                        href={withRange(`${base}/${r.id}`)}
                        className="bg-card text-card-foreground ring-foreground/6 rounded-card edge hover:shadow-e2 focus-visible:outline-foreground flex h-full flex-col gap-4 p-5 ring-1 transition-[transform,box-shadow] duration-200 ease-(--ease-ink) outline-none hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transform-none"
                      >
                        <span className="flex items-center gap-3">
                          <span
                            className={cn(
                              "grid size-9 shrink-0 place-items-center rounded-full",
                              KIND_TINT[source?.kind ?? "custom"],
                            )}
                          >
                            <ReportIcon name={source?.icon} className="size-[17px]" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="heading block truncate text-[16px]">{r.title}</span>
                            {(run?.source?.name ?? source?.name) !== r.title && (
                              <span className="text-muted-foreground block truncate text-[12.5px]">
                                {run?.source?.name ?? source?.name ?? "A database you can't see"}
                              </span>
                            )}
                          </span>
                          {tag && (
                            <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-semibold">
                              {tag}
                            </span>
                          )}
                        </span>
                        {head ? (
                          <span className="flex flex-col gap-2">
                            <span className="flex items-baseline gap-2">
                              <span className="numeral text-[32px] leading-none">{head.value}</span>
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
                            </span>
                            <span className="text-muted-foreground truncate text-[12.5px]">
                              {head.label}
                            </span>
                            <Trend values={head.trend} />
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-[13px]">
                            {r.widgets.length} widget{r.widgets.length === 1 ? "" : "s"}
                          </span>
                        )}
                        {line && (
                          <span className="border-border mt-auto flex items-start gap-2 border-t pt-3 text-[12.5px] leading-snug">
                            <span
                              aria-hidden="true"
                              className={cn(
                                "mt-1 size-1.5 shrink-0 rounded-full",
                                TONE_DOT[line.tone],
                              )}
                            />
                            <span className="text-muted-foreground line-clamp-2">{line.text}</span>
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {ready.length > 0 && (
            <section aria-labelledby="ready-made" className="space-y-3.5">
              <div className="flex flex-wrap items-baseline gap-2.5">
                <h2 id="ready-made" className="heading text-[17px]">
                  Ready-made for your CRM
                </h2>
                <span className="text-muted-foreground text-[13.5px]">
                  Who you talked to, who converted and their biggest issues, then the rest
                </span>
              </div>
              <ul className="bg-card ring-foreground/6 rounded-card edge divide-border divide-y ring-1">
                {ready.map((r) => {
                  const s = sourceBy.get(r.source);
                  return (
                    <li
                      key={`${r.kind}:${r.source}`}
                      className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5"
                    >
                      <span
                        className={cn(
                          "grid size-8 shrink-0 place-items-center rounded-full",
                          KIND_TINT.custom,
                        )}
                      >
                        <ReportIcon name={s?.icon} className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1 basis-56">
                        <b className="block truncate text-[14.5px]">{r.title}</b>
                        <span className="text-muted-foreground block truncate text-[12.5px]">
                          {r.description}
                        </span>
                      </span>
                      <CreateSuggestedButton
                        orgId={organization.id}
                        orgSlug={orgSlug}
                        sourceKey={r.source}
                        name={r.title}
                        ready={r.kind}
                      />
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
              <section aria-labelledby="start-report" className="space-y-3.5">
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <h2 id="start-report" className="heading text-[17px]">
                    {reports.length
                      ? "Databases without a report"
                      : "Start with a report on any database"}
                  </h2>
                  <span className="text-muted-foreground text-[13.5px]">
                    Each comes with widgets already picked
                  </span>
                </div>
                <ul className="bg-card ring-foreground/6 rounded-card edge divide-border divide-y ring-1">
                  {unreported.map((s) => {
                    const picks = suggestedWidgets(s, isAdmin).filter((t) => t !== "insights");
                    return (
                      <li
                        key={s.key}
                        className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5"
                      >
                        <span
                          className={cn(
                            "grid size-8 shrink-0 place-items-center rounded-full",
                            KIND_TINT[s.kind],
                          )}
                        >
                          <ReportIcon name={s.icon} className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1 basis-56">
                          <b className="block truncate text-[14.5px]">{s.name}</b>
                          <span className="text-muted-foreground block truncate text-[12.5px]">
                            {picks.length
                              ? [
                                  WIDGETS[picks[0]].title,
                                  ...picks.slice(1, 4).map((t) => lowerFirst(WIDGETS[t].title)),
                                ].join(", ")
                              : "Insights"}
                          </span>
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Button asChild size="sm" variant="ghost">
                            <Link href={`${base}/new?source=${encodeURIComponent(s.key)}`}>
                              Pick widgets
                            </Link>
                          </Button>
                          <CreateSuggestedButton
                            orgId={organization.id}
                            orgSlug={orgSlug}
                            sourceKey={s.key}
                            name={s.name}
                          />
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
