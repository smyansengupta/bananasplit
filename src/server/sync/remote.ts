import type pg from "pg";

import { assertNoTx } from "@/server/db/context";

/**
 * Typed reads of the website's suite_export contract (website repo:
 * supabase/suite-export.sql, contract version 1). Every call runs outside
 * any suite transaction (assertNoTx) on the job's one read-only connection,
 * and asks for at most BATCH_SIZE rows.
 */

export const BATCH_SIZE = 1000;

export interface RemoteSession {
  id: string;
  term: string;
  slot: number;
  title: string;
  starts_at: Date;
  room: string | null;
  created_at: Date;
}

export interface RemoteCheckin {
  id: string;
  session_id: string;
  email: string;
  name: string;
  source: string;
  is_guest: boolean;
  created_at: Date;
}

export interface RemoteSignup {
  id: string;
  name: string;
  email: string;
  class_year: string;
  colleges: string[];
  meet_days: string[];
  interests: string[];
  term: string;
  source: string;
  submissions: number;
  created_at: Date;
  updated_at: Date;
  added_to_list_at: Date | null;
}

export interface RemoteBallot {
  id: string;
  poll_slug: string;
  answers: unknown;
  created_at: Date;
}

export interface RemoteUnsubscribe {
  email: string;
  created_at: Date;
  handled_at: Date | null;
}

/** A keyset position: the last (timestamp, id) pair read. */
export interface Keyset {
  ts: string | null;
  id: string | null;
}

/** The subset of pg.Client the fetchers use (a test double implements it). */
export type SourceQuery = Pick<pg.Client, "query">;

export interface SourceReader {
  contractVersion(): Promise<number>;
  sessions(): Promise<RemoteSession[]>;
  checkinsSince(after: Keyset, limit?: number): Promise<RemoteCheckin[]>;
  signupsSince(after: Keyset, limit?: number): Promise<RemoteSignup[]>;
  ballotsAfter(afterId: string | null, limit?: number): Promise<RemoteBallot[]>;
  unsubscribes(): Promise<RemoteUnsubscribe[]>;
}

export function sourceReader(client: SourceQuery): SourceReader {
  const q = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
    assertNoTx("source sync fetch");
    const res = await client.query(sql, params);
    return res.rows as T[];
  };
  return {
    async contractVersion() {
      const rows = await q<{ v: number }>("SELECT suite_export.contract_version() AS v");
      return Number(rows[0]?.v);
    },
    sessions() {
      return q<RemoteSession>(
        "SELECT id, term, slot, title, starts_at, room, created_at FROM suite_export.sessions_all()",
      );
    },
    checkinsSince(after, limit = BATCH_SIZE) {
      return q<RemoteCheckin>(
        `SELECT id, session_id, email, name, source, is_guest, created_at
           FROM suite_export.checkins_since($1::timestamptz, $2::uuid, $3::int)`,
        [after.ts, after.id, limit],
      );
    },
    signupsSince(after, limit = BATCH_SIZE) {
      return q<RemoteSignup>(
        `SELECT id, name, email, class_year, colleges, meet_days, interests, term, source,
                submissions, created_at, updated_at, added_to_list_at
           FROM suite_export.signups_since($1::timestamptz, $2::uuid, $3::int)`,
        [after.ts, after.id, limit],
      );
    },
    ballotsAfter(afterId, limit = BATCH_SIZE) {
      return q<RemoteBallot>(
        "SELECT id, poll_slug, answers, created_at FROM suite_export.ballots_page($1::uuid, $2::int)",
        [afterId, limit],
      );
    },
    unsubscribes() {
      return q<RemoteUnsubscribe>("SELECT email, created_at, handled_at FROM suite_export.unsubscribes_all()");
    },
  };
}
