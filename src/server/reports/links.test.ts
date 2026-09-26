import { describe, expect, it } from "vitest";

import { parseDbViewParams } from "@/lib/databases/href";

import { reportLinks } from "./links";

const FALL = { from: "2026-07-01", to: "2026-12-31", term: "fall-2026" };
const ALL = { from: null, to: null, term: null };

function parsed(href: string) {
  const url = new URL(href, "http://x");
  return { path: url.pathname, ...parseDbViewParams(url.searchParams) };
}

describe("report deep links", () => {
  it("filter a session's check-ins", () => {
    expect(parsed(reportLinks.sessionCheckIns("claude-builders-club", "evt_1"))).toMatchObject({
      path: "/app/claude-builders-club/databases/attendance",
      filters: [
        { col: "eventId", op: "eq", value: "evt_1" },
        { col: "suppressedAt", op: "isnull", value: "true" },
      ],
      sort: { col: "checkedInAt", dir: "asc" },
    });
  });

  it("carry the range as from/to, and omit them for all time", () => {
    expect(parsed(reportLinks.firstVisits("cbc", FALL))).toMatchObject({
      path: "/app/cbc/databases/attendance",
      from: "2026-07-01",
      to: "2026-12-31",
      filters: [
        { col: "isFirstVisit", op: "eq", value: "true" },
        { col: "suppressedAt", op: "isnull", value: "true" },
      ],
    });
    const all = parsed(reportLinks.checkIns("cbc", ALL));
    expect(all.from).toBeUndefined();
    expect(all.to).toBeUndefined();
  });

  it("scope People links to the term when the range is one", () => {
    expect(parsed(reportLinks.regulars("cbc", FALL)).filters).toEqual([
      { col: "term", op: "eq", value: "fall-2026" },
      { col: "sessionsAttended", op: "gte", value: "3" },
    ]);
    expect(parsed(reportLinks.regulars("cbc", ALL)).filters).toEqual([
      { col: "sessionsAttended", op: "gte", value: "3" },
    ]);
    expect(parsed(reportLinks.lapsed("cbc"))).toMatchObject({
      path: "/app/cbc/databases/people",
      filters: [{ col: "lapsedSince", op: "isnull", value: "false" }],
      sort: { col: "lapsedSince", dir: "desc" },
    });
  });

  it("point sessions, stamps, signups and ballots at their databases", () => {
    expect(parsed(reportLinks.sessions("cbc", FALL, "WORKSHOP"))).toMatchObject({
      path: "/app/cbc/databases/sessions",
      filters: [
        { col: "attendanceCount", op: "gt", value: "0" },
        { col: "kind", op: "eq", value: "WORKSHOP" },
      ],
    });
    expect(parsed(reportLinks.stampMilestone("cbc", FALL, 5)).filters[0]).toEqual({
      col: "stampNumber",
      op: "eq",
      value: "5",
    });
    expect(parsed(reportLinks.convertedSignups("cbc", FALL))).toMatchObject({
      path: "/app/cbc/databases/signups",
      filters: [
        { col: "firstAttendedAt", op: "isnull", value: "false" },
        { col: "suppressedAt", op: "isnull", value: "true" },
      ],
    });
    expect(parsed(reportLinks.ballot("cbc", "bd_1"))).toMatchObject({
      path: "/app/cbc/databases/ballots",
      filters: [{ col: "ballotDefinitionId", op: "eq", value: "bd_1" }],
    });
  });
});
