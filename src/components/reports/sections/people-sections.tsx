import { reportLinks } from "@/server/reports/links";

import { BarList } from "../bar-list";
import { LazyStackedColumnsChart } from "../charts/lazy";
import {
  channelLabel,
  formatCount,
  formatDecimal,
  formatPct,
  longDate,
  shortDate,
  weekLabel,
} from "../format";
import { ReportCard, ReportEmpty, ReportError } from "../report-card";
import { Stat, StatRow } from "../stat";
import { TableView } from "../table-view";
import { loadReport, type ReportViewContext } from "./shared";

function share(part: number, whole: number): string | undefined {
  return whole > 0 ? `${formatDecimal((part / whole) * 100)}% of attendees` : undefined;
}

/** 4. Retention. */
export async function RetentionSection({ ctx }: { ctx: ReportViewContext }) {
  const result = await loadReport("retention", ctx);
  if (!result) return <ReportError id="retention" title="Retention" tz={ctx.tz} />;
  const r = result.data;

  return (
    <ReportCard
      id="retention"
      title="Retention"
      description="New and returning attendees, regulars, and people who stopped coming."
      viewHref={reportLinks.firstVisits(ctx.slug, ctx.link)}
      viewLabel="View first visits"
      computedAt={result.computedAt}
      tz={ctx.tz}
    >
      <StatRow>
        <Stat label="Attendees" value={formatCount(r.attendees)} detail="Different people" />
        <Stat
          label="New"
          value={formatCount(r.newAttendees)}
          detail={share(r.newAttendees, r.attendees) ?? "First visit ever"}
          href={reportLinks.firstVisits(ctx.slug, ctx.link)}
        />
        <Stat
          label="Returning"
          value={formatCount(r.returning)}
          detail={share(r.returning, r.attendees) ?? "Came before the range"}
          href={reportLinks.returningCheckIns(ctx.slug, ctx.link)}
        />
        <Stat
          label="3+ sessions"
          value={formatCount(r.regulars)}
          detail={share(r.regulars, r.attendees)}
          href={reportLinks.regulars(ctx.slug, ctx.link)}
        />
        <Stat
          label="Stopped showing up"
          value={formatCount(r.lapsedTotal)}
          detail={`Missed the last ${r.lapsedAfterSessions} sessions · ${formatCount(r.lapsedInRange)} in this range`}
          href={reportLinks.lapsed(ctx.slug)}
        />
      </StatRow>
      {r.perSession.length === 0 ? (
        <ReportEmpty>No check-ins in {ctx.rangeLabel.toLowerCase()}.</ReportEmpty>
      ) : (
        <>
          <LazyStackedColumnsChart
            label={`New and returning check-ins per session, ${r.perSession.length} sessions`}
            series={["Returning", "New"]}
            columns={r.perSession.map((s) => ({
              key: s.id,
              tick: shortDate(s.localDate),
              heading: s.title,
              sub: longDate(s.localDate, true),
              values: [s.returning, s.newAttendees],
            }))}
          />
          <TableView
            caption="New and returning check-ins per session"
            columns={[
              { key: "date", label: "Date" },
              { key: "session", label: "Session" },
              { key: "new", label: "New", numeric: true },
              { key: "returning", label: "Returning", numeric: true },
            ]}
            rows={[...r.perSession].reverse().map((s) => ({
              key: s.id,
              cells: {
                date: shortDate(s.localDate),
                session: s.title,
                new: formatCount(s.newAttendees),
                returning: formatCount(s.returning),
              },
            }))}
          />
        </>
      )}
    </ReportCard>
  );
}

/** 5. Signups. */
export async function SignupsSection({ ctx }: { ctx: ReportViewContext }) {
  const result = await loadReport("signups", ctx);
  if (!result) return <ReportError id="signups" title="Signups" tz={ctx.tz} />;
  const r = result.data;

  return (
    <ReportCard
      id="signups"
      title="Signups"
      description="New signups per week, and how many have come to a session since."
      viewHref={reportLinks.signups(ctx.slug, ctx.link)}
      viewLabel="View signups"
      computedAt={result.computedAt}
      tz={ctx.tz}
    >
      <StatRow>
        <Stat
          label="Signups"
          value={formatCount(r.total)}
          href={reportLinks.signups(ctx.slug, ctx.link)}
        />
        <Stat
          label="Came to a session"
          value={r.conversionPct === null ? "–" : formatPct(r.conversionPct)}
          detail={`${formatCount(r.converted)} of ${formatCount(r.total)}`}
          href={reportLinks.convertedSignups(ctx.slug, ctx.link)}
        />
        <Stat
          label="Median days to first visit"
          value={r.medianDaysToFirst === null ? "–" : formatDecimal(r.medianDaysToFirst)}
        />
      </StatRow>
      {r.total === 0 ? (
        <ReportEmpty>No signups in {ctx.rangeLabel.toLowerCase()}.</ReportEmpty>
      ) : (
        <>
          <LazyStackedColumnsChart
            label={`Signups per week, ${r.weeks.length} weeks`}
            series={["Came to a session", "Not yet"]}
            columns={r.weeks.map((w) => ({
              key: w.week,
              tick: shortDate(w.week),
              heading: weekLabel(w.week),
              sub: `${formatCount(w.signups)} ${w.signups === 1 ? "signup" : "signups"}`,
              values: [w.converted, w.signups - w.converted],
            }))}
          />
          {r.byChannel.length > 1 ? (
            <BarList
              label="Signups by channel"
              items={r.byChannel.map((c) => ({
                key: c.channel,
                label: channelLabel(c.channel),
                value: c.signups,
                display: formatCount(c.signups),
                detail: `${formatCount(c.converted)} came to a session`,
              }))}
            />
          ) : null}
          <TableView
            caption="Signups per week"
            columns={[
              { key: "week", label: "Week of" },
              { key: "signups", label: "Signups", numeric: true },
              { key: "converted", label: "Came to a session", numeric: true },
            ]}
            rows={[...r.weeks]
              .reverse()
              .filter((w) => w.signups > 0)
              .map((w) => ({
                key: w.week,
                cells: {
                  week: shortDate(w.week),
                  signups: formatCount(w.signups),
                  converted: formatCount(w.converted),
                },
              }))}
          />
        </>
      )}
    </ReportCard>
  );
}

/** 7. Stamp-card progress. */
export async function StampsSection({ ctx }: { ctx: ReportViewContext }) {
  const result = await loadReport("stamps", ctx);
  if (!result) return <ReportError id="stamps" title="Stamp-card progress" tz={ctx.tz} />;
  const r = result.data;

  return (
    <ReportCard
      id="stamps"
      title="Stamp-card progress"
      description="Stamp cards that reached each reward milestone in the range. Cards reset every term."
      viewHref={reportLinks.stampCards(ctx.slug, ctx.link)}
      viewLabel="View stamp cards"
      computedAt={result.computedAt}
      tz={ctx.tz}
    >
      <Stat
        label="People with a stamp"
        value={formatCount(r.stampHolders)}
        detail="Checked in at least once in the range"
      />
      {r.milestones.length === 0 ? (
        <ReportEmpty>No reward milestones are set. Add them in Settings.</ReportEmpty>
      ) : (
        <BarList
          label="Stamp cards reaching each milestone"
          max={Math.max(r.stampHolders, ...r.milestones.map((m) => m.reached))}
          items={r.milestones.map((m) => ({
            key: String(m.milestone),
            label: `${m.milestone} ${m.milestone === 1 ? "stamp" : "stamps"}`,
            value: m.reached,
            display: formatCount(m.reached),
            detail:
              r.stampHolders > 0
                ? `${formatDecimal((m.reached / r.stampHolders) * 100)}% of stamp holders`
                : undefined,
            href: reportLinks.stampMilestone(ctx.slug, ctx.link, m.milestone),
          }))}
        />
      )}
    </ReportCard>
  );
}
