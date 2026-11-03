/**
 * When the Databases and reports ambient buttons show (Buttons3: Databases
 * and reports). Each rule is a plain function of what the page already
 * read, so the database header, the Duplicates page, the import and the
 * report pages agree. Pure: no database, no request APIs.
 */

export interface DuplicateEvent {
  id: string;
  attendanceCount: number;
  sourceSessionId: string | null;
}

export interface DuplicatePair {
  a: string;
  b: string;
  score: number;
}

/**
 * Which of a likely pair to keep: the one with more check-ins, then the
 * one the website links (the Duplicates page suggests the same).
 */
export function suggestedKeep<T extends DuplicateEvent>(a: T, b: T): { keep: T; drop: T } {
  const keepA =
    a.attendanceCount > b.attendanceCount ||
    (a.attendanceCount === b.attendanceCount && Boolean(a.sourceSessionId));
  return keepA ? { keep: a, drop: b } : { keep: b, drop: a };
}

/**
 * The merges "Merge N" makes, surest pairs first: each session in at most
 * one, so a chain (A, B and B, C) merges A and B now and leaves the rest
 * for a look.
 */
export function mergePlan(
  pairs: readonly DuplicatePair[],
  events: readonly DuplicateEvent[],
): { survivorId: string; loserId: string }[] {
  const byId = new Map(events.map((e) => [e.id, e]));
  const used = new Set<string>();
  const out: { survivorId: string; loserId: string }[] = [];
  for (const p of [...pairs].sort((x, y) => y.score - x.score)) {
    const a = byId.get(p.a);
    const b = byId.get(p.b);
    if (!a || !b || used.has(a.id) || used.has(b.id)) continue;
    const { keep, drop } = suggestedKeep(a, b);
    used.add(a.id).add(b.id);
    out.push({ survivorId: keep.id, loserId: drop.id });
  }
  return out;
}

/** "Merge 4": the likely pairs, for admins. Null when there's nothing to merge. */
export function mergeDuplicates(
  pairs: readonly DuplicatePair[],
  events: readonly DuplicateEvent[],
  canEdit: boolean,
): { count: number; reason: string } | null {
  if (!canEdit) return null;
  const count = mergePlan(pairs, events).length;
  if (count === 0) return null;
  return {
    count,
    reason:
      count === 1
        ? "Same day, same time, same title"
        : `${count} pairs on the same day, at the same time, with the same title`,
  };
}

/**
 * "Fix 3 rows": an import that finished and skipped rows for a problem the
 * file can fix (each line counted once; the whole-file problems on line 1
 * aren't rows).
 */
export function rowsToFix(
  issues: readonly { line: number; message: string }[] | undefined,
  committed: boolean,
): { count: number; reason: string } | null {
  if (!committed || !issues) return null;
  const lines = new Set(issues.filter((i) => i.line > 1).map((i) => i.line));
  if (lines.size === 0) return null;
  return {
    count: lines.size,
    reason: lines.size === 1 ? "1 row was skipped" : `${lines.size} rows were skipped`,
  };
}

/** "Make a report": a database with rows that no report reads yet. */
export function needsReport(input: {
  canReport: boolean;
  hasReport: boolean;
  rows: number;
}): { reason: string } | null {
  if (!input.canReport || input.hasReport || input.rows === 0) return null;
  return { reason: "No report reads this database yet" };
}

/** "Reconnect": the website sync stopped (admins see the connection). */
export function syncStopped(
  sync: { status: string; lastError: string | null } | null,
): { reason: string } | null {
  if (!sync) return null;
  if (sync.status === "NEEDS_REAUTH")
    return { reason: "The website sync's sign-in stopped working" };
  if (sync.status === "ERROR") return { reason: "The website sync stopped" };
  return null;
}
