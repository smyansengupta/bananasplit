import type { DatabaseKind } from "@/generated/prisma/client";

import type { DatabaseSource } from "../types";
import { attendanceSource } from "./attendance";
import { ballotChoicesSource, ballotsSource } from "./ballots";
import { peopleSource } from "./people";
import { sessionsSource } from "./sessions";
import { signupsSource } from "./signups";

/**
 * The data source of each built-in database kind. CUSTOM definitions have
 * no source yet (the custom-table builder is a later phase), so they are not
 * listed.
 */
const SOURCES: Partial<Record<DatabaseKind, Record<string, DatabaseSource>>> = {
  SESSIONS: { default: sessionsSource },
  ATTENDANCE: { default: attendanceSource },
  SIGNUPS: { default: signupsSource },
  PEOPLE: { default: peopleSource },
  BALLOTS: { default: ballotChoicesSource, choices: ballotChoicesSource, ballots: ballotsSource },
};

export function sourceFor(kind: DatabaseKind, view?: string | null): DatabaseSource | null {
  const views = SOURCES[kind];
  if (!views) return null;
  return (view && views[view]) || views.default || null;
}

export function hasSource(kind: DatabaseKind): boolean {
  return Boolean(SOURCES[kind]);
}

export {
  attendanceSource,
  ballotChoicesSource,
  ballotsSource,
  peopleSource,
  sessionsSource,
  signupsSource,
};
