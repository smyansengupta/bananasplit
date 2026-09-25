import { dbViewHref, type DbViewFilter, type DbViewParams } from "@/lib/databases/href";

/**
 * "View data" deep links from each report into the database views, in the
 * shared URL grammar (CONTRACTS: /app/{slug}/databases/{dbKey}?f=col:op:value
 * &sort=col:dir&from=&to=), built only through dbViewHref.
 *
 * Column keys are the Prisma field names of the rows each view lists
 * (Attendance, Event, Signup, BallotChoice, and ContactTermStats/Contact
 * for People). from/to are the report's org-local dates, applied by the view
 * to its primary date column (checkedInAt, startsAt, signedUpAt).
 *
 * The number on a card and the row count of its link match exactly where
 * the view lists one row per counted thing (see docs/features/reports.md,
 * "Deep links").
 */

export interface LinkRange {
  from: string | null;
  to: string | null;
  /** The term the range is exactly, if any (People is per term). */
  term: string | null;
}

function dates(range: LinkRange): Pick<DbViewParams, "from" | "to"> {
  return {
    ...(range.from ? { from: range.from } : {}),
    ...(range.to ? { to: range.to } : {}),
  };
}

const HELD: DbViewFilter = { col: "attendanceCount", op: "gt", value: 0 };
/** Suppressed check-ins and signups never count in a report. */
const LIVE: DbViewFilter = { col: "suppressedAt", op: "isnull", value: true };

export const reportLinks = {
  /** Every check-in of one session. */
  sessionCheckIns(slug: string, eventId: string): string {
    return dbViewHref(slug, "attendance", {
      filters: [{ col: "eventId", op: "eq", value: eventId }, LIVE],
      sort: { col: "checkedInAt", dir: "asc" },
    });
  },

  /** Every check-in in the range. */
  checkIns(slug: string, range: LinkRange): string {
    return dbViewHref(slug, "attendance", {
      filters: [LIVE],
      ...dates(range),
      sort: { col: "checkedInAt", dir: "desc" },
    });
  },

  /** The sessions of the range (events with check-ins), optionally one kind. */
  sessions(slug: string, range: LinkRange, kind?: string): string {
    const filters: DbViewFilter[] = [HELD];
    if (kind) filters.push({ col: "kind", op: "eq", value: kind });
    return dbViewHref(slug, "sessions", { filters, ...dates(range), sort: { col: "startsAt", dir: "asc" } });
  },

  /** First-ever check-ins in the range: one row per new attendee. */
  firstVisits(slug: string, range: LinkRange): string {
    return dbViewHref(slug, "attendance", {
      filters: [{ col: "isFirstVisit", op: "eq", value: true }, LIVE],
      ...dates(range),
      sort: { col: "checkedInAt", dir: "asc" },
    });
  },

  /** Check-ins by returning attendees in the range. */
  returningCheckIns(slug: string, range: LinkRange): string {
    return dbViewHref(slug, "attendance", {
      filters: [{ col: "isFirstVisit", op: "eq", value: false }, LIVE],
      ...dates(range),
      sort: { col: "checkedInAt", dir: "asc" },
    });
  },

  /** People with 3+ sessions (per term when the range is one term). */
  regulars(slug: string, range: LinkRange): string {
    const filters: DbViewFilter[] = [];
    if (range.term) filters.push({ col: "term", op: "eq", value: range.term });
    filters.push({ col: "sessionsAttended", op: "gte", value: 3 });
    return dbViewHref(slug, "people", { filters, sort: { col: "sessionsAttended", dir: "desc" } });
  },

  /** People who stopped showing up (Contact.lapsedSince set). */
  lapsed(slug: string): string {
    return dbViewHref(slug, "people", {
      filters: [{ col: "lapsedSince", op: "isnull", value: false }],
      sort: { col: "lapsedSince", dir: "desc" },
    });
  },

  /** Stamp totals of the term (People). */
  stampCards(slug: string, range: LinkRange): string {
    const filters: DbViewFilter[] = [];
    if (range.term) filters.push({ col: "term", op: "eq", value: range.term });
    filters.push({ col: "stampCount", op: "gte", value: 1 });
    return dbViewHref(slug, "people", { filters, sort: { col: "stampCount", dir: "desc" } });
  },

  /** The check-ins that earned stamp number `milestone` in the range: one per card. */
  stampMilestone(slug: string, range: LinkRange, milestone: number): string {
    return dbViewHref(slug, "attendance", {
      filters: [{ col: "stampNumber", op: "eq", value: milestone }, LIVE],
      ...dates(range),
      sort: { col: "checkedInAt", dir: "asc" },
    });
  },

  /** Signups of the range. */
  signups(slug: string, range: LinkRange): string {
    return dbViewHref(slug, "signups", {
      filters: [LIVE],
      ...dates(range),
      sort: { col: "signedUpAt", dir: "desc" },
    });
  },

  /** Signups of the range that have attended since. */
  convertedSignups(slug: string, range: LinkRange): string {
    return dbViewHref(slug, "signups", {
      filters: [{ col: "firstAttendedAt", op: "isnull", value: false }, LIVE],
      ...dates(range),
      sort: { col: "signedUpAt", dir: "desc" },
    });
  },

  /** One ballot's rows (the pivot for tiers without row access). */
  ballot(slug: string, definitionId: string): string {
    return dbViewHref(slug, "ballots", {
      filters: [{ col: "ballotDefinitionId", op: "eq", value: definitionId }],
    });
  },

  /** All ballots. */
  ballots(slug: string): string {
    return dbViewHref(slug, "ballots");
  },
} as const;
