import { ArrowDownRight, ArrowUpRight, CalendarDays, Minus } from "@/components/icons";

import { Badge } from "@/components/ui/badge";
import { reportLinks } from "@/server/reports/links";

import { BarList } from "../bar-list";
import { LazyAttendanceLineChart } from "../charts/lazy";
import {
  formatCount,
  formatDecimal,
  formatSigned,
  formatSignedPct,
  kindLabel,
  longDate,
  shortDate,
} from "../format";
import { ReportCard, ReportEmpty, ReportError } from "../report-card";
import { Stat, StatRow } from "../stat";
import { TableView } from "../table-view";
import { loadReport, type ReportViewContext } from "./shared";

/** 1. Last session. */
export async function LastSessionSection({ ctx }: { ctx: ReportViewContext }) {
  const result = await loadReport("last-session", ctx);
  if (!result) return <ReportError id="last-session" title="Last session" tz={ctx.tz} />;
  const { current, previous, delta, deltaPct } = result.data;

  return (
    <ReportCard
      id="last-session"
      title="Last session"
      description="Check-ins at the latest session in the range, against the session before it."
      viewHref={current ? reportLinks.sessionCheckIns(ctx.slug, current.id) : null}
      viewLabel="View check-ins"
      computedAt={result.computedAt}
      tz={ctx.tz}
    >
      {!current ? (
        <ReportEmpty icon={CalendarDays}>
          No session with check-ins in {ctx.rangeLabel.toLowerCase()}.
        </ReportEmpty>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
            <span className="numeral text-[44px]">{formatCount(current.checkIns)}</span>
            <p className="text-muted-foreground pb-1 text-sm leading-snug">
              {current.checkIns === 1 ? "member" : "members"} checked in at{" "}
              <span className="text-foreground font-medium">{current.title}</span> on{" "}
              <span className="whitespace-nowrap">{longDate(current.localDate)}</span>
            </p>
          </div>
          {previous && delta !== null ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <Badge variant={delta > 0 ? "success" : delta < 0 ? "destructive" : "secondary"}>
                {delta > 0 ? (
                  <ArrowUpRight aria-hidden="true" />
                ) : delta < 0 ? (
                  <ArrowDownRight aria-hidden="true" />
                ) : (
                  <Minus aria-hidden="true" />
                )}
                <span className="sr-only">
                  {delta > 0 ? "Up" : delta < 0 ? "Down" : "No change"}
                </span>
                {formatSigned(delta)}
                {deltaPct !== null ? ` (${formatSignedPct(deltaPct)})` : ""}
              </Badge>
              <span className="text-muted-foreground">
                vs. {previous.title} on {shortDate(previous.localDate)} (
                {formatCount(previous.checkIns)})
              </span>
            </p>
          ) : (
            <p className="text-muted-foreground text-sm">
              The first session on record: nothing to compare with yet.
            </p>
          )}
          <StatRow className="sm:grid-cols-2">
            <Stat
              label="First-time visitors"
              value={formatCount(current.firstTimers)}
              detail={
                current.checkIns > 0
                  ? `${formatDecimal((current.firstTimers / current.checkIns) * 100)}% of check-ins`
                  : undefined
              }
            />
            <Stat
              label="Type"
              value={<span className="text-[19px]">{kindLabel(current.kind)}</span>}
            />
          </StatRow>
        </>
      )}
    </ReportCard>
  );
}

/** 2. Attendance over time. */
export async function AttendanceSection({ ctx }: { ctx: ReportViewContext }) {
  const result = await loadReport("attendance", ctx);
  if (!result) return <ReportError id="attendance" title="Attendance over time" tz={ctx.tz} />;
  const r = result.data;

  return (
    <ReportCard
      id="attendance"
      title="Attendance over time"
      description="Check-ins per session, in date order."
      viewHref={reportLinks.checkIns(ctx.slug, ctx.link)}
      viewLabel="View check-ins"
      computedAt={result.computedAt}
      tz={ctx.tz}
    >
      {r.totalSessions === 0 ? (
        <ReportEmpty icon={CalendarDays}>
          No sessions with check-ins in {ctx.rangeLabel.toLowerCase()}.
        </ReportEmpty>
      ) : (
        <>
          <StatRow className="sm:grid-cols-4">
            <Stat
              label="Sessions"
              value={formatCount(r.totalSessions)}
              href={reportLinks.sessions(ctx.slug, ctx.link)}
            />
            <Stat label="Check-ins" value={formatCount(r.totalCheckIns)} />
            <Stat
              label="Average per session"
              value={r.average === null ? "–" : formatDecimal(r.average)}
            />
            <Stat
              label="Best turnout"
              value={r.peak ? formatCount(r.peak.checkIns) : "–"}
              detail={r.peak ? `${r.peak.title}, ${shortDate(r.peak.localDate)}` : undefined}
            />
          </StatRow>
          {r.sessions.length >= 2 ? (
            <LazyAttendanceLineChart
              average={r.average}
              points={r.sessions.map((s) => ({
                id: s.id,
                title: s.title,
                kind: s.kind,
                localDate: s.localDate,
                checkIns: s.checkIns,
              }))}
            />
          ) : null}
          {r.sessions.length < r.totalSessions ? (
            <p className="text-muted-foreground text-xs">
              Showing the latest {formatCount(r.sessions.length)} of {formatCount(r.totalSessions)}{" "}
              sessions.
            </p>
          ) : null}
          <TableView
            caption="Check-ins per session"
            columns={[
              { key: "date", label: "Date" },
              { key: "session", label: "Session" },
              { key: "n", label: "Check-ins", numeric: true },
            ]}
            rows={[...r.sessions].reverse().map((s) => ({
              key: s.id,
              cells: { date: shortDate(s.localDate), session: s.title, n: formatCount(s.checkIns) },
            }))}
          />
        </>
      )}
    </ReportCard>
  );
}

/** 3. Session breakdown. */
export async function SessionTypesSection({ ctx }: { ctx: ReportViewContext }) {
  const result = await loadReport("session-types", ctx);
  if (!result) return <ReportError id="session-types" title="Session breakdown" tz={ctx.tz} />;
  const { rows } = result.data;

  return (
    <ReportCard
      id="session-types"
      title="Session breakdown"
      description="Average check-ins per session, by type."
      viewHref={reportLinks.sessions(ctx.slug, ctx.link)}
      viewLabel="View sessions"
      computedAt={result.computedAt}
      tz={ctx.tz}
    >
      {rows.length === 0 ? (
        <ReportEmpty icon={CalendarDays}>
          No sessions with check-ins in {ctx.rangeLabel.toLowerCase()}.
        </ReportEmpty>
      ) : (
        <>
          <BarList
            label="Average check-ins by session type"
            items={rows.map((row) => ({
              key: row.kind,
              label: kindLabel(row.kind),
              value: row.average,
              display: formatDecimal(row.average),
              detail: `${formatCount(row.sessions)} ${row.sessions === 1 ? "session" : "sessions"} · median ${formatDecimal(row.median)} · best ${formatCount(row.max)}`,
              href: reportLinks.sessions(ctx.slug, ctx.link, row.kind),
            }))}
          />
          <TableView
            caption="Attendance by session type"
            columns={[
              { key: "kind", label: "Type" },
              { key: "sessions", label: "Sessions", numeric: true },
              { key: "checkIns", label: "Check-ins", numeric: true },
              { key: "avg", label: "Average", numeric: true },
              { key: "median", label: "Median", numeric: true },
              { key: "max", label: "Best", numeric: true },
            ]}
            rows={rows.map((row) => ({
              key: row.kind,
              cells: {
                kind: kindLabel(row.kind),
                sessions: formatCount(row.sessions),
                checkIns: formatCount(row.checkIns),
                avg: formatDecimal(row.average),
                median: formatDecimal(row.median),
                max: formatCount(row.max),
              },
            }))}
          />
        </>
      )}
    </ReportCard>
  );
}
