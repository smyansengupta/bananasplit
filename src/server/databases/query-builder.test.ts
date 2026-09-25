// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

// The sources import the member reads, which pull in the Auth.js config; the
// query builder itself never touches a session.
vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn(), getSession: vi.fn() }));

import { dbViewQuery, parseDbViewParams } from "@/lib/databases/href";

import { buildQuery, DbQueryError, localDay, MAX_PAGE_SIZE, parseKeyList, parseSize, type QuerySpec } from "./query-builder";
import { attendanceSource, ballotChoicesSource, peopleSource, sessionsSource, signupsSource } from "./sources";
import type { ViewContext } from "./types";

const ctx: ViewContext = {
  organizationId: "org_1",
  orgSlug: "cbc",
  timezone: "America/New_York",
  role: "OWNER",
  tier: "OWNER",
  canEdit: true,
  now: new Date("2026-09-24T12:00:00Z"),
};

const TZ = { timezone: "America/New_York" };

function params(qs: string) {
  return parseDbViewParams(new URLSearchParams(qs));
}

const sessions = sessionsSource.query(ctx);
const attendance = attendanceSource.query(ctx);

describe("buildQuery: allowlist", () => {
  it("rejects an unknown column and never passes it through", () => {
    const q = buildQuery(sessions, params("f=secret:eq:1&sort=secret:asc"), TZ);
    expect(q.rejected.map((r) => r.reason)).toEqual(["unknown column", "unknown column"]);
    expect(q.where).toEqual({});
    expect(JSON.stringify(q.orderBy)).not.toContain("secret");
  });

  it("throws on an unknown column in strict mode", () => {
    expect(() => buildQuery(sessions, params("f=secret:eq:1"), { ...TZ, strict: true })).toThrow(DbQueryError);
  });

  it("rejects operators a column does not take and display-only sorts", () => {
    const q = buildQuery(sessions, params("f=kind:contains:work&sort=host:asc"), TZ);
    expect(q.rejected).toHaveLength(2);
    expect(q.where).toEqual({});
  });

  it("binds injection attempts as values (no identifier comes from the URL)", () => {
    const evil = "x'); DROP TABLE \"Event\"; --";
    const q = buildQuery(sessions, params(dbViewQuery({ filters: [{ col: "title", op: "contains", value: evil }] })), TZ);
    expect(q.where).toEqual({ AND: [{ title: { contains: evil, mode: "insensitive" } }] });
    const bad = buildQuery(sessions, params('f=title");--:eq:1'), TZ);
    expect(bad.where).toEqual({});
  });

  it("rejects enum values outside the enum", () => {
    const q = buildQuery(sessions, params("f=kind:eq:ROOT"), TZ);
    expect(q.rejected[0]?.reason).toBe("invalid value");
    expect(buildQuery(sessions, params("f=kind:eq:workshop"), TZ).where).toEqual({ AND: [{ kind: { equals: "WORKSHOP" } }] });
  });

  it("caps the page size at 100 and computes the offset", () => {
    expect(parseSize("500")).toBe(MAX_PAGE_SIZE);
    expect(parseSize("abc")).toBe(50);
    const q = buildQuery(sessions, params("page=3"), { ...TZ, size: 25 });
    expect(q).toMatchObject({ skip: 50, take: 25, page: 3, size: 25 });
  });

  it("parses cols/nd lists against the allowed keys only", () => {
    expect(parseKeyList("title,bogus,kind", ["title", "kind"])).toEqual(["title", "kind"]);
    expect(parseKeyList(undefined, ["title"])).toBeNull();
  });
});

describe("buildQuery: every sortable and filterable Sessions column", () => {
  it.each([
    ["startsAt", { startsAt: "asc" }],
    ["kind", { kind: "asc" }],
    ["visibility", { visibility: "asc" }],
    ["title", { title: "asc" }],
    ["term", { term: { sort: "asc", nulls: "last" } }],
    ["attendanceCount", { attendanceCount: "asc" }],
  ])("sorts by %s with an id tiebreak", (col, order) => {
    const q = buildQuery(sessions, params(`sort=${col}:asc`), TZ);
    expect(q.orderBy).toEqual([order, { id: "asc" }]);
  });

  it("filters host by member id, term, kind in, attendance > 0 and linked", () => {
    const q = buildQuery(
      sessions,
      params("f=hostUserId:eq:u1&f=term:eq:fall-2026&f=kind:in:WORKSHOP,SOCIAL&f=attendanceCount:gt:0&f=linked:eq:true"),
      TZ,
    );
    expect(q.rejected).toEqual([]);
    expect(q.where).toEqual({
      AND: [
        { hostUserId: { equals: "u1" } },
        { term: { equals: "fall-2026" } },
        { kind: { in: ["WORKSHOP", "SOCIAL"] } },
        { attendanceCount: { gt: 0 } },
        { sourceSessionId: { not: null } },
      ],
    });
  });
});

describe("dates are org-local days", () => {
  it("localDay spans 25 hours on the DST end date in New York", () => {
    const day = localDay("2026-11-01", "America/New_York");
    expect(day?.start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(day?.end.toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(localDay("2026-02-31", "UTC")).toBeNull();
  });

  it("check-ins at 05:30 and 06:30 UTC on 2026-11-01 are both on the local day 2026-11-01", () => {
    const q = buildQuery(attendance, params("f=checkedInAt:eq:2026-11-01&nd=suppressedAt"), TZ);
    const where = q.where as { AND: { checkedInAt: { gte: Date; lt: Date } }[] };
    const range = where.AND[0].checkedInAt;
    for (const iso of ["2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z"]) {
      const t = new Date(iso).getTime();
      expect(t >= range.gte.getTime() && t < range.lt.getTime()).toBe(true);
    }
    // A 23:00 EDT check-in on Oct 31 (03:00 UTC Nov 1) stays on Oct 31.
    expect(new Date("2026-11-01T03:00:00Z").getTime() < range.gte.getTime()).toBe(true);
  });

  it("from/to filter the view's main date column, inclusive of the last local day", () => {
    const q = buildQuery(attendance, params("from=2026-09-01&to=2026-09-30"), TZ);
    expect(q.from).toBe("2026-09-01");
    expect(JSON.stringify(q.where)).toContain('"checkedInAt":{"gte":"2026-09-01T04:00:00.000Z"}');
    expect(JSON.stringify(q.where)).toContain('"checkedInAt":{"lt":"2026-10-01T04:00:00.000Z"}');
  });

  it("gt/lte on a day mean after / through that local day", () => {
    const q = buildQuery(sessions, params("f=startsAt:gt:2026-09-10&f=startsAt:lte:2026-09-20"), TZ);
    expect(q.where).toEqual({
      AND: [
        { startsAt: { gte: new Date("2026-09-11T04:00:00.000Z") } },
        { startsAt: { lt: new Date("2026-09-21T04:00:00.000Z") } },
      ],
    });
  });
});

describe("default filters and the Reports deep links", () => {
  it("hides suppressed check-ins by default and lets an explicit suppression filter replace it", () => {
    const def = buildQuery(attendance, params(""), TZ);
    expect(def.filters).toEqual([{ col: "suppressedAt", op: "isnull", value: "true", isDefault: true }]);
    const report = buildQuery(attendance, params("f=eventId:eq:e1&f=suppressedAt:isnull:true"), TZ);
    expect(report.filters.filter((f) => f.isDefault)).toEqual([]);
    expect(report.where).toEqual({ AND: [{ eventId: { equals: "e1" } }, { suppressedAt: null }] });
    const only = buildQuery(attendance, params("f=suppressed:eq:true"), TZ);
    expect(only.where).toEqual({ AND: [{ suppressedAt: { not: null } }] });
  });

  it("takes the Reports keys: stampNumber, isFirstVisit, checkedInAt", () => {
    const q = buildQuery(attendance, params("f=stampNumber:eq:3&f=isFirstVisit:eq:false&sort=checkedInAt:asc"), TZ);
    expect(q.rejected).toEqual([]);
    expect(q.where).toEqual({
      AND: [{ stampNumber: { equals: 3 } }, { isFirstVisit: { equals: false } }, { suppressedAt: null }],
    });
  });

  it("People defaults to the current term only when the URL states no filter", () => {
    const people = peopleSource.query(ctx);
    expect(buildQuery(people, params(""), TZ).where).toEqual({ AND: [{ term: { equals: "fall-2026" } }] });
    const lapsed = buildQuery(people, params("f=lapsedSince:isnull:false&sort=lapsedSince:desc"), TZ);
    expect(lapsed.where).toEqual({ AND: [{ contact: { lapsedSince: { not: null } } }] });
    expect(lapsed.orderBy[0]).toEqual({ contact: { lapsedSince: { sort: "desc", nulls: "last" } } });
    const regulars = buildQuery(people, params("f=term:eq:fall-2026&f=sessionsAttended:gte:3"), TZ);
    expect(regulars.where).toEqual({ AND: [{ term: { equals: "fall-2026" } }, { sessionsAttended: { gte: 3 } }] });
    expect(buildQuery(people, params(""), { ...TZ, noDefaults: ["term"] }).where).toEqual({});
  });

  it("Signups take suppressedAt and firstAttendedAt isnull", () => {
    const q = buildQuery(signupsSource.query(ctx), params("f=firstAttendedAt:isnull:false&f=suppressedAt:isnull:true"), TZ);
    expect(q.where).toEqual({ AND: [{ firstAttendedAt: { not: null } }, { suppressedAt: null }] });
  });

  it("Signups filter JSON arrays but refuse to sort them", () => {
    const spec = signupsSource.query(ctx);
    const q = buildQuery(spec, params("f=colleges:contains:khoury&sort=colleges:asc"), TZ);
    expect(q.rejected).toEqual([{ part: "sort=colleges", reason: "this column cannot be sorted" }]);
    expect(q.where).toEqual({
      AND: [{ answers: { path: ["colleges"], array_contains: ["khoury"] } }, { suppressedAt: null }],
    });
  });

  it("Ballots take ballotDefinitionId (id or slug) and hide excluded ballots by default", () => {
    const q = buildQuery(ballotChoicesSource.query(ctx), params("f=ballotDefinitionId:eq:bd_1"), TZ);
    expect(q.where).toEqual({
      AND: [
        { OR: [{ ballotDefinitionId: "bd_1" }, { ballot: { pollSlug: "bd_1" } }] },
        { ballot: { excludedReason: null } },
      ],
    });
  });
});

describe("search", () => {
  it("searches the contact name, the masked email and (RLS permitting) the address", () => {
    const q = buildQuery(attendance, params("q=Ada"), TZ);
    const text = JSON.stringify(q.where);
    expect(text).toContain('"displayName":{"contains":"Ada","mode":"insensitive"}');
    expect(text).toContain('"emails":{"some":{"emailNormalized":{"contains":"ada"}}}');
  });

  it("every search field of every source is a text field", () => {
    for (const source of [sessionsSource, attendanceSource, signupsSource, peopleSource, ballotChoicesSource]) {
      const spec: QuerySpec = source.query(ctx);
      for (const key of spec.search ?? []) {
        expect(["string", "text"]).toContain(spec.fields[key].kind);
      }
    }
  });
});
