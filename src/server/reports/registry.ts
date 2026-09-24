import type { DatabaseKind } from "@/generated/prisma/enums";

import { queryAttendance } from "./queries/attendance";
import { queryBallots } from "./queries/ballots";
import type { ReportQuery } from "./queries/common";
import { queryLastSession } from "./queries/last-session";
import { queryRetention } from "./queries/retention";
import { querySessionTypes } from "./queries/session-types";
import { querySignups } from "./queries/signups";
import { queryStamps } from "./queries/stamps";
import type { ReportId, ReportPayloads } from "./types";

export interface ReportDefinition<Id extends ReportId = ReportId> {
  id: Id;
  title: string;
  /**
   * The databases the report reads. A report is computed and rendered for
   * a tier only when every one of them is visible to it
   * (DatabaseDefinition.memberVisibility through app.can_view_rows).
   */
  sources: readonly DatabaseKind[];
  query: ReportQuery<ReportPayloads[Id]>;
}

type Registry = { [Id in ReportId]: ReportDefinition<Id> };

export const REPORTS: Registry = {
  "last-session": {
    id: "last-session",
    title: "Last session",
    sources: ["SESSIONS", "ATTENDANCE"],
    query: queryLastSession,
  },
  attendance: {
    id: "attendance",
    title: "Attendance over time",
    sources: ["SESSIONS", "ATTENDANCE"],
    query: queryAttendance,
  },
  "session-types": {
    id: "session-types",
    title: "Session breakdown",
    sources: ["SESSIONS", "ATTENDANCE"],
    query: querySessionTypes,
  },
  retention: {
    id: "retention",
    title: "Retention",
    sources: ["ATTENDANCE", "PEOPLE"],
    query: queryRetention,
  },
  signups: {
    id: "signups",
    title: "Signups",
    sources: ["SIGNUPS", "ATTENDANCE"],
    query: querySignups,
  },
  ballots: {
    id: "ballots",
    title: "Ballots",
    sources: ["BALLOTS"],
    query: queryBallots,
  },
  stamps: {
    id: "stamps",
    title: "Stamp-card progress",
    sources: ["ATTENDANCE", "PEOPLE"],
    query: queryStamps,
  },
};

/** Every database kind any report reads. */
export const REPORT_SOURCE_KINDS: readonly DatabaseKind[] = [
  ...new Set(Object.values(REPORTS).flatMap((r) => r.sources)),
];
