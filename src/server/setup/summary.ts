import { JobStatus } from "@/generated/prisma/client";
import type { TxClient } from "@/server/db/context";
import { listDatabases } from "@/server/databases/views";
import type { Role } from "@/generated/prisma/enums";
import { loadSyncStatus, type SyncStatus } from "@/server/sync/status";

/**
 * "What came in": the numbers the result screen shows after a connection
 * succeeds, and the same numbers on the connection-status page.
 *
 * Counts are the real row counts an admin would see in the databases, read
 * in the caller's app_user transaction (RLS bounds every one of them to the
 * org). Nothing is cached: the point of this screen is to be true at the
 * second it is read.
 */

export interface DataCounts {
  checkIns: number;
  signups: number;
  sessions: number;
  people: number;
  ballots: number;
}

export function totalRows(counts: DataCounts): number {
  return counts.checkIns + counts.signups + counts.sessions + counts.people + counts.ballots;
}

/** Where to send someone for each kind, using the org's own database keys. */
export interface DatabaseLinks {
  sessions: string | null;
  attendance: string | null;
  signups: string | null;
  ballots: string | null;
  people: string | null;
}

export interface DataSummary {
  counts: DataCounts;
  links: DatabaseLinks;
  /** The newest per-stream sync time, or null when nothing has synced. */
  syncedAt: Date | null;
  /** A source-sync job is queued or running right now. */
  syncing: boolean;
  /** Per-stream detail, or null when the org has no data source at all. */
  sync: SyncStatus | null;
}

/**
 * A sync job the org is waiting on *now*.
 *
 * `runAt <= now` matters: every run schedules the next hour's backstop
 * before it finishes, so there is almost always a PENDING source-sync row
 * with a future runAt. Counting those would leave the result screen saying
 * "pulling your data in" forever.
 */
export async function syncPending(
  db: TxClient,
  organizationId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const pending = await db.job.count({
    where: {
      organizationId,
      kind: "source-sync",
      status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
      runAt: { lte: now },
    },
  });
  return pending > 0;
}

export async function loadDataCounts(db: TxClient, organizationId: string): Promise<DataCounts> {
  return {
    // The same filters the database views count with, so the result screen
    // and the Databases page never disagree by a suppressed row.
    checkIns: await db.attendance.count({ where: { organizationId, suppressedAt: null } }),
    signups: await db.signup.count({ where: { organizationId, suppressedAt: null } }),
    sessions: await db.event.count({
      where: { organizationId, deletedAt: null, mergedIntoId: null },
    }),
    people: await db.contact.count({ where: { organizationId, sessionsAttended: { gt: 0 } } }),
    ballots: await db.ballot.count({ where: { organizationId } }),
  };
}

/** The org's own database keys, so a renamed database still links correctly. */
export async function loadDatabaseLinks(
  db: TxClient,
  organizationId: string,
  role: Role,
  slug: string,
): Promise<DatabaseLinks> {
  const list = await listDatabases(db, organizationId, role);
  const href = (kind: string) => {
    const key = list.find((d) => d.kind === kind)?.key;
    return key ? `/app/${slug}/databases/${key}` : null;
  };
  return {
    sessions: href("SESSIONS"),
    attendance: href("ATTENDANCE"),
    signups: href("SIGNUPS"),
    ballots: href("BALLOTS"),
    people: href("PEOPLE"),
  };
}

export async function loadDataSummary(
  db: TxClient,
  organizationId: string,
  role: Role,
  slug: string,
): Promise<DataSummary> {
  const sync = await loadSyncStatus(db, organizationId);
  const times = (sync?.streams ?? [])
    .map((s) => s.lastSyncedAt)
    .filter((d): d is Date => d instanceof Date);
  return {
    counts: await loadDataCounts(db, organizationId),
    links: await loadDatabaseLinks(db, organizationId, role, slug),
    syncedAt: times.length ? new Date(Math.max(...times.map((d) => d.getTime()))) : null,
    syncing: await syncPending(db, organizationId),
    sync,
  };
}

/**
 * The one line the result screen leads with. Plural-correct, and honest
 * about a source that connected but brought nothing back yet.
 */
export function countsSentence(counts: DataCounts): string {
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => {
    if (n > 0) parts.push(`${n.toLocaleString()} ${n === 1 ? one : many}`);
  };
  add(counts.checkIns, "check-in", "check-ins");
  add(counts.signups, "signup", "signups");
  add(counts.sessions, "session", "sessions");
  add(counts.ballots, "ballot", "ballots");
  if (parts.length === 0) return "Nothing yet";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
