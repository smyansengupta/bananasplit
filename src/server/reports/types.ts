/**
 * Report payloads (Phase 5). Plain JSON only: unstable_cache stores
 * JSON.stringify(result), so a cache hit and a miss must look the same.
 * Instants are ISO strings (UTC), org-local calendar dates are yyyy-mm-dd.
 * Components import these as types only.
 */

export const REPORT_IDS = [
  "last-session",
  "attendance",
  "session-types",
  "retention",
  "signups",
  "ballots",
  "stamps",
] as const;

export type ReportId = (typeof REPORT_IDS)[number];

/** The viewer tier every report is computed for. TREASURER counts as MEMBER. */
export type ReportTier = "OWNER" | "ADMIN" | "MEMBER";

export const REPORT_TIERS: readonly ReportTier[] = ["OWNER", "ADMIN", "MEMBER"];

/** One session: a non-deleted, non-merged Event with at least one check-in. */
export interface SessionPoint {
  id: string;
  title: string;
  kind: string;
  /** ISO instant of Event.startsAt. */
  startsAt: string;
  /** Org-local date of Event.startsAt. */
  localDate: string;
  /** Non-suppressed check-ins (Event.attendanceCount). */
  checkIns: number;
}

export interface LastSessionReport {
  current: (SessionPoint & { firstTimers: number }) | null;
  previous: SessionPoint | null;
  /** current - previous; null without a previous session. */
  delta: number | null;
  /** delta / previous * 100, one decimal; null without a previous session or when it had 0. */
  deltaPct: number | null;
}

export interface AttendanceReport {
  /** Oldest first; at most 400 (the most recent). */
  sessions: SessionPoint[];
  totalSessions: number;
  totalCheckIns: number;
  /** totalCheckIns / totalSessions, one decimal; null without sessions. */
  average: number | null;
  peak: SessionPoint | null;
}

export interface SessionTypeRow {
  kind: string;
  sessions: number;
  checkIns: number;
  average: number;
  median: number;
  max: number;
}

export interface SessionTypesReport {
  rows: SessionTypeRow[];
}

export interface RetentionSessionRow {
  id: string;
  title: string;
  localDate: string;
  newAttendees: number;
  returning: number;
}

export interface RetentionReport {
  /** Oldest first; at most 400. */
  perSession: RetentionSessionRow[];
  /** Distinct people who checked in at a session in the range. */
  attendees: number;
  /** Of those, people whose first-ever check-in was in the range. */
  newAttendees: number;
  /** attendees - newAttendees. */
  returning: number;
  /** People with 3 or more sessions in the range. */
  regulars: number;
  /** Contacts currently lapsed (Contact.lapsedSince set). */
  lapsedTotal: number;
  /** Of those, the ones whose lapse started in the range. */
  lapsedInRange: number;
  /** OrgSettings.lapsedAfterSessions. */
  lapsedAfterSessions: number;
}

export interface SignupWeek {
  /** Monday of the org-local week. */
  week: string;
  signups: number;
  /** Signups of that week that have attended since. */
  converted: number;
}

export interface SignupChannelRow {
  channel: string;
  signups: number;
  converted: number;
}

export interface SignupsReport {
  weeks: SignupWeek[];
  total: number;
  converted: number;
  /** converted / total * 100, one decimal; null without signups. */
  conversionPct: number | null;
  /** Median Signup.daysToFirstAttendance of the converted signups. */
  medianDaysToFirst: number | null;
  byChannel: SignupChannelRow[];
}

export interface BallotOptionResult {
  key: string;
  label: string;
  /** null when suppressed (below k for a tier without row access). */
  votes: number | null;
  /** Ranked questions only. */
  firstChoice: number | null;
  borda: number | null;
  suppressed: boolean;
}

export interface BallotQuestionResult {
  key: string;
  label: string;
  type: string;
  /** Ballots that answered this question. */
  ballots: number;
  options: BallotOptionResult[];
}

export interface BallotResult {
  id: string;
  slug: string;
  title: string;
  opensAt: string | null;
  closesAt: string | null;
  /** Valid ballots (not excluded as test or out of window). */
  ballots: number;
  linkedSession: { id: string; title: string; localDate: string; checkIns: number } | null;
  /** ballots / linked session check-ins * 100, one decimal; null = n/a. */
  turnoutPct: number | null;
  questions: BallotQuestionResult[];
  /** Free-text questions are never tallied. */
  freeTextQuestions: number;
}

export interface BallotsReport {
  /** True when the org hides ballot results from members and the viewer is a MEMBER. */
  hidden: boolean;
  /** OrgSettings.ballotMinCellSize (the k in '<k'). */
  minCellSize: number;
  /** Whether this tier sees individual cells unsuppressed. */
  fullCounts: boolean;
  ballots: BallotResult[];
}

export interface StampMilestoneRow {
  milestone: number;
  /** Stamp cards (one per person per term) that reached the milestone in the range. */
  reached: number;
}

export interface StampsReport {
  milestones: StampMilestoneRow[];
  /** People who earned at least one stamp in the range. */
  stampHolders: number;
}

export interface ReportPayloads {
  "last-session": LastSessionReport;
  attendance: AttendanceReport;
  "session-types": SessionTypesReport;
  retention: RetentionReport;
  signups: SignupsReport;
  ballots: BallotsReport;
  stamps: StampsReport;
}

export interface ReportResult<Id extends ReportId = ReportId> {
  id: Id;
  /** ISO instant the payload was computed (the card's 'as of'). */
  computedAt: string;
  data: ReportPayloads[Id];
}
