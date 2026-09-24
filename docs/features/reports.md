# Reports: setup and metric definitions

The Reports tab (sidebar > Reports, `/app/{slug}/reports`) turns the
Databases into answers: seven default reports over one date range, each with
a "View" link into the underlying database view, already filtered.

## For an org

**Nothing to switch on.** Reports read the org's own Sessions, Attendance,
Signups, Ballots and People databases. Data arrives from the website sync
(Settings > Integrations > Data source), CSV imports and admin edits in
Databases; the reports follow as soon as it lands.

**Settings that change the numbers** (Settings > General / Privacy, OWNER or
ADMIN):

| Setting | Default | Used by |
|---|---|---|
| Stamp milestones (`stampMilestones`) | 3, 5, 8 | Stamp-card progress: one bar per milestone |
| Lapsed after N sessions (`lapsedAfterSessions`) | 3 | Retention: "stopped showing up" |
| Reports refresh (`reportsRefreshSeconds`) | 300 | How long a computed report is reused (30 s to 24 h) |
| Ballot results visible to members | on | Ballots: members see nothing when off |
| Individual ballots visible to | Owner only | Who sees exact counts; everyone else gets '<k' for small cells |
| Smallest shown count k (`ballotMinCellSize`) | 3 | Ballots: cells below k show as '<k' |
| Database visibility (Privacy) | Signups: admins; others: members | A report is shown only if every database it reads is visible to you |
| Organization timezone | UTC (CBC: America/New_York) | Every date, week and term boundary |

**Who sees what.** Every member can open Reports. What each person sees
follows their role, with Treasurer counted as Member:

| Report | Reads | Member (default) | Admin | Owner |
|---|---|---|---|---|
| Last session, Attendance over time, Session breakdown | Sessions, Attendance | yes | yes | yes |
| Retention, Stamp-card progress | Attendance, People | yes | yes | yes |
| Signups | Signups, Attendance | no (Signups is admins-only by default) | yes | yes |
| Ballots | Ballots | totals, small cells as '<k' | totals, small cells as '<k' | exact counts |

Making a database owner-only or hidden in Privacy hides every report that
reads it from the roles that can no longer see it, on the next page view.
Reports never show who voted for what, never show free-text answers, and
never list people: the links do that, in Databases, under Databases' own
visibility rules.

**Date range.** One range applies to every card: This term (the default),
Last 30 days, All time, or a custom first and last day. Terms split at July 1
in the org timezone (January to June is spring, July to December is fall),
the same rule the website uses. Bookmark or share the URL to keep a range
(`?range=30d`, `?range=all`, `?from=2026-09-01&to=2026-09-30`).

**Freshness.** Every card says when it was computed ("as of 6:42 PM"). A
report is recomputed when data changes (the website sync, an event edit, an
admin edit), when the refresh interval passes, or when anyone presses
**Refresh** (limited to 12 a minute per person). An open Reports tab also
reloads itself on the refresh interval while it is visible.

## Metric definitions

**Session.** An event (a Sessions row) that is not deleted or merged and has
at least one check-in. Board meetings and upcoming events have none, so they
never count. A session belongs to the range by the org-local date it starts;
all of its check-ins go with it.

**Check-in.** An Attendance row that is not suppressed. Suppressed rows (a
duplicate scan, a test scan) never count anywhere.

1. **Last session.** The latest session in the range: "X members checked in
   at [session] on [date]", where X is its check-ins. The change compares it
   with the session right before it (in or before the range): the difference
   in check-ins and the percentage of the earlier session's count. The first
   session on record has no comparison. First-time visitors are check-ins
   that were the person's first check-in ever.
2. **Attendance over time.** One point per session, in date order (the
   latest 400 when there are more). Average = check-ins / sessions. Best
   turnout = the session with the most check-ins.
3. **Session breakdown.** Per session type (workshop, info session, social,
   hackathon, board meeting, other): sessions, check-ins, and the average,
   median and highest check-ins per session. Sorted by average.
4. **Retention.**
   - Attendees: different people who checked in at a session of the range.
   - New: attendees whose first check-in ever falls in the range. Returning:
     the rest (they had come before the range).
   - Per session: check-ins that were a first visit ever (new) against all
     others (returning).
   - 3+ sessions: attendees at three or more different sessions of the range.
   - Stopped showing up: people who have missed the last N sessions the org
     held (N = "Lapsed after N sessions"), as the lapsed job computes it
     (Contact.lapsedSince); "in this range" counts those whose first missed
     session falls in the range. People who never checked in are not counted.
5. **Signups.** Signups (every channel: website, Typeform, officer, CSV,
   manual; suppressed ones excluded) placed by the org-local date they signed
   up.
   - Per week: Monday-to-Sunday weeks in the org timezone, from the first
     signup of the range to the end of the range or this week.
   - Came to a session: signups whose person checked in at any session from
     one day before signing up onward. Conversion = came / signups.
   - Median days to first visit: over the signups that came, whole days from
     signing up to that first check-in.
6. **Ballots.** Non-test ballots whose voting window overlaps the range, or
   that have a ballot cast in it (the 12 most recent). Results are always the
   ballot's full tally.
   - Ballots: valid ballots (not excluded as test or out of window).
   - Turnout: valid ballots / check-ins at the ballot's linked session, or
     n/a without a linked session that has check-ins. It can pass 100% when
     people vote without checking in.
   - Single, multiple-choice and yes/no questions: votes per option and the
     share of that question's answers.
   - Ranked questions: Borda points (an option ranked r-th on a ballot that
     ranks n options scores n - r + 1), first-choice votes, and how many
     ballots ranked it at all. Sorted by points.
   - Small cells: for every role without access to individual ballots, an
     option with fewer than k votes shows as '<k' (including options nobody
     chose), and write-in answers outside the ballot's options that fewer
     than k people gave fold into one "Other answers" row, so no single vote
     can be singled out.
7. **Stamp-card progress.** A stamp card is one person in one term (stamps
   reset each term); every check-in earns the next stamp. For each milestone
   m, the cards that reached m in the range, i.e. check-ins of the range that
   earned stamp number m. For a one-term range this is the number of people
   with at least m stamps who got there in that term. People with a stamp:
   different people who checked in in the range.

## Deep links

Each "View" link opens the database view with the same filters, in the
shared URL grammar (`?f=col:op:value&sort=col:dir&from=&to=`; see
`src/lib/databases/href.ts`). Column keys are the Prisma field names;
`from`/`to` are the range's org-local days, applied to the view's date column
(checkedInAt, startsAt, signedUpAt).

| Card number | Link | Rows match the number |
|---|---|---|
| Last session | `attendance?f=eventId:eq:{id}&f=suppressedAt:isnull:true` | yes |
| Attendance over time | `attendance?f=suppressedAt:isnull:true&from&to`; Sessions tile: `sessions?f=attendanceCount:gt:0&from&to` | yes |
| Session breakdown, per type | `sessions?f=attendanceCount:gt:0&f=kind:eq:{KIND}&from&to` | yes |
| Retention, New | `attendance?f=isFirstVisit:eq:true&f=suppressedAt:isnull:true&from&to` | yes (one first visit per person) |
| Retention, Returning | `attendance?f=isFirstVisit:eq:false&...` | lists their check-ins, not people |
| Retention, 3+ sessions | `people?f=term:eq:{term}&f=sessionsAttended:gte:3` | yes for a one-term range |
| Retention, Stopped showing up | `people?f=lapsedSince:isnull:false` | yes |
| Signups, Came to a session | `signups?f=firstAttendedAt:isnull:false&f=suppressedAt:isnull:true&from&to` | yes |
| Stamp milestone m | `attendance?f=stampNumber:eq:{m}&f=suppressedAt:isnull:true&from&to` | yes (one row per card) |
| Ballot | `ballots?f=ballotDefinitionId:eq:{id}` | the ballot's rows, or its pivot for members |

A check-in a few minutes after midnight at a session that started the day
before is counted with its session in reports but falls on the next day in a
date-filtered view; that is the only way a link and its card can differ.

## How it works (for developers)

- `src/app/app/[orgSlug]/reports/page.tsx` authorizes (getOrgContextBySlug),
  derives the tier (`src/server/reports/tier.ts`), resolves the range to
  explicit org-local dates (`range.ts`), asks the database which reports the
  tier may see (`visibility.ts`, app.can_view_rows, uncached) and renders each
  visible report in its own Suspense boundary. Charts are recharts loaded with
  `next/dynamic` (`ssr: false`) and use only the `--chart-1..5` tokens; every
  charted value is also printed or in the card's "Show as table".
- `src/server/reports/cache.ts`: `getReport(id, key, refreshSeconds)` wraps
  `unstable_cache` with keyParts `['report', id, 'v1']`, tags
  `tags.reports(orgId)` and `tags.reports(orgId, id)`, `revalidate` =
  reportsRefreshSeconds, and positional primitive arguments
  `(id, orgId, tier, from, to, tz, reportsDataVersion, OrgSettings.updatedAt)`.
  So owner and member ballot results never share an entry, "this term" and
  the same custom dates share one, and a data or settings change always
  changes the key. The computation opens its own `withSystemOrgTx(orgId)` and
  never reads the request's transaction, cookies or headers.
- `src/server/reports/queries/*.ts`: one or two aggregate statements per
  report, tagged-template `$queryRaw` with bound values only, an explicit
  organizationId predicate everywhere, and org-local bucketing written as
  `((col AT TIME ZONE 'UTC') AT TIME ZONE tz)` (the columns are `timestamp
  without time zone` holding UTC). Range bounds are converted to UTC once so
  the predicates use the `(organizationId, date)` indexes. Ballots call
  `app.ballot_tally(org, definition, tier)` with the tier passed explicitly.
- Invalidation: `markReportsDataChanged({ db, organizationId })` in
  `src/server/reports/data-version.ts` bumps `OrgSettings.reportsDataVersion`
  in the caller's transaction and queues `invalidate([tags.reports(orgId)])`
  for after commit. The event service already invalidates the tag on every
  event save. The Refresh button is the `refreshReports` Server Action.

## Testing

- `src/server/reports/reports.db.test.ts` builds a small fixture org
  (`testing/fixture.ts`) with every number known by construction, runs each
  report's SQL on the service path and asserts exact results, the ballot
  privacy (k-suppression for members and admins, full counts for the owner,
  hidden results, no user GUC), the visibility gate, invalidation after
  commit only, and that the deep links count the same rows. The DST test
  buckets check-ins and signups around the 2026-11-01 change in
  America/New_York with the session TimeZone set to UTC and to
  America/New_York. It needs the local database (`MIGRATE_DATABASE_URL`) and
  skips without it; the fixture org is deleted afterwards.
- `cache.test.ts` (cache keys and tags), `range.test.ts`, `links.test.ts`,
  `ballots.test.ts` and `isolation.test.ts` (no request context in the loader
  modules) run without a database.
