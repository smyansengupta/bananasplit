import { CalendarCheck2, Users } from "@/components/icons";

import { KIND_META } from "@/components/calendar/kinds";
import { Insight, LinkChips } from "@/components/overview/connections";
import { formatCount, shortDate } from "@/components/reports/format";
import { ReportCard, ReportEmpty, ReportError } from "@/components/reports/report-card";
import { Stat, StatRow } from "@/components/reports/stat";
import { Prisma } from "@/generated/prisma/client";
import type { EventKind } from "@/generated/prisma/enums";
import { percent } from "@/lib/overview/insights";
import { localDateKey } from "@/lib/tasks/dates";
import { withSystemOrgTx } from "@/server/db/context";
import { turnoutOf } from "@/server/overview/queries";
import { inRange, localDateText, nowUtc, num } from "@/server/reports/sql";

/**
 * Who's in the organization and who comes, on Reports (they left Home: the
 * Overview is for what needs you, this is the analysis). Two cards beside
 * the cached reports:
 *
 * - People: members, active this month, joined this week, the board, and
 *   the class years members gave on their profiles. All counts: no member
 *   rows are read, only the org chart's seats.
 * - Attendance: RSVPs against check-ins for each event of the range, the
 *   share of RSVPs that check in, and how many first-timers came back.
 *
 * Both count on the service path (only numbers leave; sign-ups hold guests'
 * contact details) AFTER the page has authorized the viewer. Attendance is
 * rendered only when the viewer's tier may see attendance (the page checks
 * the same database visibility as the cached reports); an event whose RSVP
 * page hides its count stays out for anyone but owners and admins.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The share of `part` in `whole`, as "38%", or null without a whole. */
function share(part: number, whole: number): string | null {
  return whole > 0 ? percent(part / whole) : null;
}

export async function PeopleSummarySection({
  orgId,
  slug,
  tz,
}: {
  orgId: string;
  slug: string;
  tz: string;
}) {
  const now = new Date();
  let data;
  try {
    data = await withSystemOrgTx(orgId, async ({ db }) => {
      const members = await db.membership.count({ where: { organizationId: orgId } });
      const joinedThisWeek = await db.membership.count({
        where: { organizationId: orgId, joinedAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } },
      });
      // Used the workspace in the last 30 days, and still a member. Visits
      // are only stamped from the earliest one on, so a younger record
      // counts (and says) since then instead.
      const member = { memberships: { some: { organizationId: orgId } } };
      const first = await db.memberPresence.aggregate({
        where: { organizationId: orgId },
        _min: { lastSeenAt: true },
      });
      const monthAgo = new Date(now.getTime() - 30 * DAY_MS);
      const presenceSince = first._min.lastSeenAt;
      const active = await db.memberPresence.count({
        where: { organizationId: orgId, lastSeenAt: { gte: monthAgo }, user: member },
      });
      const years = await db.user.groupBy({
        by: ["gradYear"],
        where: { ...member, gradYear: { not: null } },
        _count: { _all: true },
      });
      const officers = await db.membership.count({
        where: { organizationId: orgId, role: { not: "MEMBER" } },
      });
      const org = await db.organization.findUnique({
        where: { id: orgId },
        select: { activeOrgChartVersionId: true },
      });
      const positions = org?.activeOrgChartVersionId
        ? await db.orgChartPosition.findMany({
            where: {
              organizationId: orgId,
              versionId: org.activeOrgChartVersionId,
              isAdvisor: false,
            },
            select: { isOpen: true, userId: true },
            take: 500,
          })
        : null;
      // Class years among the board: the chart's seated members, else the officers.
      const boardYears = await db.user.groupBy({
        by: ["gradYear"],
        where: {
          AND: [
            member,
            { gradYear: { not: null } },
            positions
              ? { id: { in: positions.flatMap((p) => (!p.isOpen && p.userId ? [p.userId] : [])) } }
              : { memberships: { some: { organizationId: orgId, role: { not: "MEMBER" } } } },
          ],
        },
        _count: { _all: true },
      });
      return {
        members,
        joinedThisWeek,
        active,
        partial: presenceSince !== null && presenceSince > monthAgo ? presenceSince : null,
        years,
        officers,
        positions,
        boardYears,
      };
    });
  } catch (error) {
    console.error("[reports] people failed", error instanceof Error ? error.message : error);
    return <ReportError id="people" title="People" tz={tz} />;
  }

  // The board: the published org chart's filled seats, else the officers.
  const chart = data.positions;
  const board = chart ? chart.filter((p) => !p.isOpen).length : data.officers;
  const openRoles = chart ? chart.filter((p) => p.isOpen).length : 0;

  // Class years members gave, oldest class first.
  const yearRows = data.years
    .flatMap((y) => (y.gradYear != null ? [[y.gradYear, y._count._all] as const] : []))
    .sort((a, b) => a[0] - b[0]);
  const gaveYear = yearRows.reduce((n, [, c]) => n + c, 0);
  const shades = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5"];

  // The newest class against its seats on the board, when both are there.
  const newest = yearRows.at(-1);
  const boardWithYear = data.boardYears.reduce((n, y) => n + y._count._all, 0);
  const newestOnBoard = newest
    ? (data.boardYears.find((y) => y.gradYear === newest[0])?._count._all ?? 0)
    : 0;
  const finding =
    newest && newest[1] >= 3 && boardWithYear >= 3
      ? {
          lead: `The class of ${newest[0]} is ${share(newest[1], gaveYear)} of members`,
          text: `who gave a year, and holds ${newestOnBoard} of the ${boardWithYear} board seats whose holder gave one.`,
        }
      : null;
  // Visits are stamped from a date under 30 days ago: say since when.
  const since = data.partial ? shortDate(localDateKey(data.partial, tz)) : null;

  return (
    <ReportCard
      id="people"
      title="People"
      description={`${formatCount(data.members)} members`}
      viewHref={`/app/${slug}/people`}
      viewLabel="Open People"
      tz={tz}
    >
      <StatRow>
        <Stat
          label={since ? `Active since ${since}` : "Active this month"}
          value={formatCount(data.active)}
          detail={
            since
              ? `Opened the workspace since ${since}, when visits began to be counted`
              : "Opened the workspace in the last 30 days"
          }
        />
        <Stat
          label="Joined this week"
          value={`+${formatCount(data.joinedThisWeek)}`}
          href={`/app/${slug}/people`}
        />
        <Stat
          label={chart ? "On the board" : "Officers"}
          value={formatCount(board)}
          detail={
            chart
              ? openRoles > 0
                ? `${openRoles} ${openRoles === 1 ? "role" : "roles"} open`
                : "Every role filled"
              : "Owners, admins and treasurers"
          }
          href={chart ? `/app/${slug}/org-chart` : undefined}
        />
      </StatRow>
      {yearRows.length > 0 ? (
        <div className="space-y-2">
          <span
            role="img"
            aria-label={yearRows
              .map(([year, n]) => `Class of ${year}: ${share(n, gaveYear)}`)
              .join(", ")}
            className="flex h-2.5 overflow-hidden rounded-full"
          >
            {yearRows.map(([year, n], i) => (
              <span
                key={year}
                className="h-full"
                style={{
                  width: `${(n / gaveYear) * 100}%`,
                  background: `var(${shades[i % shades.length]})`,
                }}
              />
            ))}
          </span>
          <p className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {yearRows.map(([year, n]) => (
              <span key={year}>
                Class of {year} {share(n, gaveYear)}
              </span>
            ))}
            <span>
              {formatCount(gaveYear)} of {formatCount(data.members)} gave a year
            </span>
          </p>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          No member has a class year on their profile yet.
        </p>
      )}
      {finding && (
        <Insight icon={Users}>
          <b>{finding.lead}</b> {finding.text}
        </Insight>
      )}
      <LinkChips
        items={[
          { kind: "person", label: "People", href: `/app/${slug}/people` },
          ...(chart
            ? [{ kind: "database" as const, label: "Org chart", href: `/app/${slug}/org-chart` }]
            : []),
        ]}
      />
    </ReportCard>
  );
}

interface EventRow {
  id: string;
  title: string;
  kind: string;
  local_date: string;
  rsvp_enabled: boolean;
  attendance_count: number | bigint;
  hide_count: boolean;
}

/** Bars per event at most (the latest). */
const MAX_EVENTS = 24;

export async function RsvpAttendanceSection({
  orgId,
  slug,
  tz,
  from,
  to,
  rangeLabel,
  isAdmin,
  showReturns,
}: {
  orgId: string;
  slug: string;
  tz: string;
  from: string | null;
  to: string | null;
  rangeLabel: string;
  isAdmin: boolean;
  /** First-timers who came back reads people's check-ins (the Retention report's sources). */
  showReturns: boolean;
}) {
  let data;
  try {
    data = await withSystemOrgTx(orgId, async ({ db }) => {
      const rows = await db.$queryRaw<EventRow[]>`
        SELECT e."id", e."title", e."kind"::text AS kind,
               ${localDateText(Prisma.sql`e."startsAt"`, tz)} AS local_date,
               e."rsvpEnabled" AS rsvp_enabled, e."attendanceCount" AS attendance_count,
               e."rsvpHideCount" AS hide_count
          FROM public."Event" e
         WHERE e."organizationId" = ${orgId}
           AND e."deletedAt" IS NULL
           AND e."mergedIntoId" IS NULL
           AND e."startsAt" < ${nowUtc(null)}
           AND ${inRange(Prisma.sql`e."startsAt"`, from, to, tz)}
         ORDER BY e."startsAt" DESC, e."id" DESC
         LIMIT 120`;
      const events = rows
        .filter((r) => isAdmin || !r.hide_count)
        .map((r) => ({
          id: r.id,
          title: r.title,
          kind: r.kind,
          localDate: r.local_date,
          rsvpEnabled: r.rsvp_enabled,
          attendanceCount: num(r.attendance_count),
        }));
      const turnout = await turnoutOf(db, orgId, events);
      const returns = showReturns
        ? await db.$queryRaw<{ first_timers: number | bigint; came_back: number | bigint }[]>`
            WITH firsts AS (
              SELECT a."contactId", a."checkedInAt"
                FROM public."Attendance" a
                JOIN public."Event" e ON e."organizationId" = a."organizationId" AND e."id" = a."eventId"
               WHERE a."organizationId" = ${orgId}
                 AND a."isFirstVisit"
                 AND a."suppressedAt" IS NULL
                 AND e."deletedAt" IS NULL
                 AND ${inRange(Prisma.sql`e."startsAt"`, from, to, tz)}
            )
            SELECT count(*)::int AS first_timers,
                   (count(*) FILTER (WHERE EXISTS (
                      SELECT 1 FROM public."Attendance" b
                       WHERE b."organizationId" = ${orgId}
                         AND b."contactId" = f."contactId"
                         AND b."suppressedAt" IS NULL
                         AND b."checkedInAt" > f."checkedInAt")))::int AS came_back
              FROM firsts f`
        : null;
      return { events, turnout, returns: returns?.[0] ?? null };
    });
  } catch (error) {
    console.error(
      "[reports] rsvp attendance failed",
      error instanceof Error ? error.message : error,
    );
    return <ReportError id="rsvp-attendance" title="RSVPs and check-ins" tz={tz} />;
  }

  const rows = data.events
    .map((e) => ({ ...e, ...(data.turnout.get(e.id) ?? { rsvps: 0, checkIns: 0 }) }))
    .filter((e) => e.rsvps > 0 || e.checkIns > 0);
  // The share that checks in, over events that had both.
  const both = rows.filter((e) => e.rsvps > 0 && e.checkIns > 0);
  const rsvps = both.reduce((n, e) => n + e.rsvps, 0);
  const checkIns = both.reduce((n, e) => n + e.checkIns, 0);
  const top = [...rows].sort((a, b) => b.checkIns - a.checkIns)[0];
  const firstTimers = num(data.returns?.first_timers);
  const cameBack = num(data.returns?.came_back);

  // Kinds side by side, when two or more have both numbers.
  const kinds = new Map<string, { rsvps: number; checkIns: number }>();
  for (const e of both) {
    const k = kinds.get(e.kind) ?? { rsvps: 0, checkIns: 0 };
    kinds.set(e.kind, { rsvps: k.rsvps + e.rsvps, checkIns: k.checkIns + e.checkIns });
  }
  const kindRates = [...kinds]
    .map(([kind, k]) => ({ kind, rate: k.checkIns / k.rsvps }))
    .sort((a, b) => b.rate - a.rate);
  const label = (kind: string) =>
    kind === "OTHER"
      ? "other events"
      : `${KIND_META[kind as EventKind]?.label.toLowerCase() ?? kind}s`;

  const shown = rows.slice(0, MAX_EVENTS).reverse();
  const most = Math.max(1, ...shown.map((e) => Math.max(e.rsvps, e.checkIns)));

  return (
    <ReportCard
      id="rsvp-attendance"
      title="RSVPs and check-ins"
      description={rangeLabel}
      viewHref={`/app/${slug}/calendar`}
      viewLabel="Open the calendar"
      tz={tz}
    >
      <StatRow>
        <Stat
          label="Of RSVPs check in"
          value={share(checkIns, rsvps) ?? "–"}
          detail={
            both.length > 0
              ? `${formatCount(checkIns)} of ${formatCount(rsvps)}, over ${both.length} ${both.length === 1 ? "event" : "events"}`
              : "No event has both yet"
          }
        />
        {data.returns && (
          <Stat
            label="First-timers who came back"
            value={share(cameBack, firstTimers) ?? "–"}
            detail={`${formatCount(cameBack)} of ${formatCount(firstTimers)} came to another session`}
          />
        )}
        {top && top.checkIns > 0 && (
          <Stat
            label={`Came to ${top.title}`}
            value={formatCount(top.checkIns)}
            detail={`The most in ${rangeLabel.toLowerCase()}`}
            href={`/app/${slug}/calendar/${top.id}`}
          />
        )}
      </StatRow>
      {shown.length === 0 ? (
        <ReportEmpty icon={CalendarCheck2}>
          No RSVPs or check-ins in {rangeLabel.toLowerCase()}.
        </ReportEmpty>
      ) : (
        <div className="space-y-3">
          <ol
            aria-label="RSVPs and check-ins per event"
            className="flex h-36 items-end gap-2 overflow-x-auto pb-1"
          >
            {shown.map((e) => (
              <li
                key={e.id}
                className="flex min-w-9 flex-1 flex-col items-center gap-1.5"
                title={`${e.title}, ${shortDate(e.localDate)}: ${e.rsvps} RSVPs, ${e.checkIns} checked in`}
              >
                <span className="sr-only">
                  {`${e.title}: ${e.rsvps} ${e.rsvps === 1 ? "RSVP" : "RSVPs"}, ${e.checkIns} checked in`}
                </span>
                <span aria-hidden="true" className="flex h-28 w-full items-end justify-center gap-1">
                  <span
                    className="w-1/2 max-w-5 rounded-t-[5px] bg-[color-mix(in_oklab,var(--chart-1)_28%,var(--card))]"
                    style={{ height: `${(e.rsvps / most) * 100}%` }}
                  />
                  <span
                    className="w-1/2 max-w-5 rounded-t-[5px] bg-(--chart-1)"
                    style={{ height: `${(e.checkIns / most) * 100}%` }}
                  />
                </span>
                <span className="text-muted-foreground text-[11px] whitespace-nowrap">
                  {shortDate(e.localDate)}
                </span>
              </li>
            ))}
          </ol>
          <p className="text-muted-foreground flex gap-4 text-xs">
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2.5 rounded-[3px] bg-[color-mix(in_oklab,var(--chart-1)_28%,var(--card))]"
              />
              RSVPs
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2.5 rounded-[3px] bg-(--chart-1)" />
              Checked in
            </span>
          </p>
        </div>
      )}
      {kindRates.length >= 2 && (
        <Insight>
          <b>
            {kindRates[0]!.kind === "OTHER"
              ? "Other events"
              : `${KIND_META[kindRates[0]!.kind as EventKind]?.label ?? kindRates[0]!.kind}s`}{" "}
            check in {percent(kindRates[0]!.rate)} of their RSVPs,
          </b>{" "}
          {kindRates
            .slice(1)
            .map((k) => `${label(k.kind)} ${percent(k.rate)}`)
            .join(", ")}
          .
        </Insight>
      )}
    </ReportCard>
  );
}
