import { describe, expect, it } from "vitest";

import { dbViewHref, DbViewParamError, parseDbViewParams } from "./href";

describe("dbViewHref", () => {
  it("builds the view URL grammar", () => {
    const href = dbViewHref("claude-builders-club", "attendance", {
      filters: [
        { col: "eventId", op: "eq", value: "evt_1" },
        { col: "stampNumber", op: "gte", value: 3 },
        { col: "method", op: "in", value: ["FORM", "QR"] },
        { col: "userId", op: "isnull" },
      ],
      sort: { col: "checkedInAt", dir: "desc" },
      q: "ann",
      from: "2026-09-01",
      to: new Date("2026-12-15T12:00:00Z"),
      page: 2,
      row: "att_9",
    });
    const url = new URL(href, "http://x");
    expect(url.pathname).toBe("/app/claude-builders-club/databases/attendance");
    expect(url.searchParams.getAll("f")).toEqual([
      "eventId:eq:evt_1",
      "stampNumber:gte:3",
      "method:in:FORM,QR",
      "userId:isnull:true",
    ]);
    expect(url.searchParams.get("sort")).toBe("checkedInAt:desc");
    expect(url.searchParams.get("from")).toBe("2026-09-01");
    expect(url.searchParams.get("to")).toBe("2026-12-15");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("row")).toBe("att_9");
  });

  it("omits the query string when there is nothing to filter", () => {
    expect(dbViewHref("cbc", "sessions")).toBe("/app/cbc/databases/sessions");
    expect(dbViewHref("cbc", "sessions", { page: 1 })).toBe("/app/cbc/databases/sessions");
  });

  it("refuses malformed parts", () => {
    expect(() =>
      dbViewHref("cbc", "sessions", { filters: [{ col: "a;drop", op: "eq", value: "x" }] }),
    ).toThrow(DbViewParamError);
    expect(() =>
      dbViewHref("cbc", "sessions", { filters: [{ col: "a", op: "in", value: ["x,y"] }] }),
    ).toThrow();
    expect(() => dbViewHref("cbc", "sessions", { filters: [{ col: "a", op: "eq" }] })).toThrow();
    expect(() => dbViewHref("cbc", "sessions", { from: "09/01/2026" })).toThrow();
    expect(() => dbViewHref("Bad Slug", "sessions")).toThrow();
    expect(() => dbViewHref("cbc", "../x")).toThrow();
  });
});

describe("parseDbViewParams", () => {
  it("round-trips what dbViewHref writes, keeping colons in values", () => {
    const href = dbViewHref("cbc", "sessions", {
      filters: [
        { col: "title", op: "contains", value: "10:30 talk" },
        { col: "kind", op: "in", value: ["WORKSHOP", "SOCIAL"] },
      ],
      sort: { col: "startsAt", dir: "asc" },
      q: "claude",
      page: 3,
    });
    const parsed = parseDbViewParams(new URL(href, "http://x").searchParams);
    expect(parsed).toEqual({
      filters: [
        { col: "title", op: "contains", value: "10:30 talk" },
        { col: "kind", op: "in", value: "WORKSHOP,SOCIAL", values: ["WORKSHOP", "SOCIAL"] },
      ],
      sort: { col: "startsAt", dir: "asc" },
      q: "claude",
      from: undefined,
      to: undefined,
      page: 3,
      row: undefined,
    });
  });

  it("drops malformed parts instead of failing (Next searchParams record form)", () => {
    const parsed = parseDbViewParams({
      f: ["bad", "x:nope:1", "ok:eq:1", "n:isnull:maybe"],
      sort: "col:sideways",
      page: "-4",
      from: "yesterday",
    });
    expect(parsed.filters).toEqual([{ col: "ok", op: "eq", value: "1" }]);
    expect(parsed.sort).toBeUndefined();
    expect(parsed.page).toBe(1);
    expect(parsed.from).toBeUndefined();
  });
});
