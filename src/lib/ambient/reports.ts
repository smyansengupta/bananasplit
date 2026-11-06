/**
 * When a saved report's ambient buttons show (Buttons3: Databases and
 * reports): a kept copy whose database changed since, and a scheduled send
 * that didn't go out. Pure: no database, no request APIs.
 */

/** "Refresh": the report's database changed after this copy was kept. */
export function copyIsStale(
  takenAt: Date | string | null | undefined,
  changedAt: Date | null,
): { reason: string } | null {
  if (!takenAt || !changedAt) return null;
  const taken = takenAt instanceof Date ? takenAt : new Date(takenAt);
  if (changedAt.getTime() <= taken.getTime()) return null;
  return { reason: "The data changed since this copy" };
}

export interface SendJob {
  kind: string;
  /** `${kind}:${key}`, as stored. */
  dedupeKey: string;
  status: string;
  payload: unknown;
  createdAt: Date;
}

/** One job to queue again: its kind, its key without the kind, its payload. */
export interface RetryJob {
  kind: "report-send" | "report-email";
  key: string;
  payload: Record<string, unknown>;
}

/** The send day a report job is for: report-send:{id}:{day}, report-email:{id}:{day}:{user}. */
function dayOf(job: SendJob, reportId: string): string | null {
  const prefix = `${job.kind}:${reportId}:`;
  if (!job.dedupeKey.startsWith(prefix)) return null;
  return job.dedupeKey.slice(prefix.length).split(":")[0] || null;
}

/**
 * "Send again": the newest scheduled send gave up (its copy, or an email to
 * someone), and nothing for that day is still trying. Hands back what to
 * queue again; null when the last send went out.
 */
export function failedSend(
  jobs: readonly SendJob[],
  reportId: string,
): { day: string; retry: RetryJob[]; reason: string } | null {
  const ours = jobs
    .filter((j) => j.kind === "report-send" || j.kind === "report-email")
    .map((j) => ({ job: j, day: dayOf(j, reportId) }))
    .filter((x): x is { job: SendJob; day: string } => x.day !== null);
  if (ours.length === 0) return null;
  const day = ours.map((x) => x.day).sort()[ours.length - 1];
  const thatDay = ours.filter((x) => x.day === day).map((x) => x.job);
  if (thatDay.some((j) => j.status === "PENDING" || j.status === "RUNNING")) return null;
  // A key that went out after it gave up (sent again) counts as sent.
  const sent = new Set(thatDay.filter((j) => j.status === "DONE").map((j) => j.dedupeKey));
  const dead = new Map<string, SendJob>();
  for (const j of thatDay) {
    if (j.status === "DEAD" && !sent.has(j.dedupeKey)) dead.set(j.dedupeKey, j);
  }
  if (dead.size === 0) return null;
  const retry: RetryJob[] = [...dead.values()].map((j) => ({
    kind: j.kind as RetryJob["kind"],
    key: j.dedupeKey.slice(j.kind.length + 1),
    payload: (j.payload && typeof j.payload === "object" ? j.payload : {}) as Record<
      string,
      unknown
    >,
  }));
  const copyFailed = retry.some((r) => r.kind === "report-send");
  const emails = retry.filter((r) => r.kind === "report-email").length;
  return {
    day,
    retry,
    reason: copyFailed
      ? "The last scheduled send didn't go out"
      : emails === 1
        ? "1 email from the last send didn't go out"
        : `${emails} emails from the last send didn't go out`,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isoDay(month: string, day: string, year: string): string | null {
  const m = MONTHS.indexOf(month);
  const d = Number(day);
  if (m === -1 || !(d >= 1 && d <= 31)) return null;
  return `${year}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * The range a kept copy was taken over, from its label ("Jul 1 – Sep 30,
 * 2026", "Dec 15, 2025 – Jan 14, 2026", "Sep 1, 2026", "All time"), so a
 * refreshed copy reads the same dates. Empty (the default range) when the
 * label isn't one of those.
 */
export function rangeOfCopy(label: string): { range?: string; from?: string; to?: string } {
  const text = label.trim();
  if (text === "All time") return { range: "all" };
  const one = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec(text);
  if (one) {
    const day = isoDay(one[1], one[2], one[3]);
    return day ? { from: day, to: day } : {};
  }
  const span =
    /^([A-Z][a-z]{2}) (\d{1,2})(?:, (\d{4}))? [–-] ([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec(text);
  if (!span) return {};
  const from = isoDay(span[1], span[2], span[3] ?? span[6]);
  const to = isoDay(span[4], span[5], span[6]);
  return from && to && from <= to ? { from, to } : {};
}
