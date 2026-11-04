import { spaceLimits, type PlanSpace } from "@/lib/billing/space";

/**
 * Version history (NoteVersion): how often autosave snapshots are taken and
 * how long they are kept.
 *
 * - A snapshot is the note as it was just before an editing session: the
 *   first save after SNAPSHOT_INTERVAL_MS without one keeps the previous
 *   body (autosave and live saves alike), so a burst of typing costs at
 *   most one version every ten minutes.
 * - Named versions ("Name this version") are kept until someone deletes
 *   them; autosave snapshots are pruned after the plan's history window
 *   (PLAN_LIMITS.noteHistoryDays: 7 on Personal Free, 90 on Team, 365 on
 *   Personal Plus and Team Advanced).
 */

/** At most one autosave snapshot per note in this long. */
export const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;

/** The space's plan columns, the trial's included (a Personal Plus trial keeps a year). */
export type HistorySpace = PlanSpace;

/** The note-history window for a space's plan, in days. */
export function noteHistoryWindowDays(space: HistorySpace): number {
  return spaceLimits(space).noteHistoryDays;
}

/** The oldest autosave snapshot kept now. */
export function historyCutoff(space: HistorySpace, now: Date = new Date()): Date {
  return new Date(now.getTime() - noteHistoryWindowDays(space) * 24 * 60 * 60 * 1000);
}

/** Whether a note last snapshotted at `last` takes a new snapshot now. */
export function snapshotDue(last: Date | null, now: Date = new Date()): boolean {
  return last === null || now.getTime() - last.getTime() >= SNAPSHOT_INTERVAL_MS;
}

export const VERSION_NAME_MAX = 120;
