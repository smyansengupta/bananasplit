/*
 * When a club's subscription renews: the start of the next semester.
 *
 * PLACEHOLDER DATES. Billing isn't built yet, and the owners haven't
 * confirmed the semester calendar; these two dates only fill in the
 * checkout's "Renews ..." line until they do. Every school's calendar
 * differs, so the real dates will likely come from the club's school.
 */

export type SemesterSeason = "spring" | "fall";

export interface SemesterStart {
  /** Midnight UTC on the semester's first day. */
  date: Date;
  season: SemesterSeason;
}

/** August (0-based UTC month): from Aug 1 the next semester is spring. */
const FALL_MONTH = 7;
const SPRING_START = { month: 0, day: 12 }; // Jan 12
const FALL_START = { month: 7, day: 25 }; // Aug 25

/**
 * The next semester's first day: Aug 1 to Dec 31 renews on Jan 12 of the
 * next year (spring), Jan 1 to Jul 31 on Aug 25 of the same year (fall).
 * Read and built in UTC, so the answer doesn't depend on the server's zone.
 */
export function nextSemesterStart(now: Date): SemesterStart {
  const year = now.getUTCFullYear();
  if (now.getUTCMonth() >= FALL_MONTH) {
    return {
      date: new Date(Date.UTC(year + 1, SPRING_START.month, SPRING_START.day)),
      season: "spring",
    };
  }
  return { date: new Date(Date.UTC(year, FALL_START.month, FALL_START.day)), season: "fall" };
}

/** "Jan 12, 2027". */
export function formatSemesterDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * When a student plan billed by the academic year renews: the next fall
 * start (Aug 25, the same placeholder as nextSemesterStart). Student plans
 * never bill for the summer.
 */
export function nextAcademicYearStart(now: Date): Date {
  const year = now.getUTCFullYear();
  const thisFall = Date.UTC(year, FALL_START.month, FALL_START.day);
  return new Date(
    now.getTime() < thisFall ? thisFall : Date.UTC(year + 1, FALL_START.month, FALL_START.day),
  );
}
