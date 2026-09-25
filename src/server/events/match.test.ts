// @vitest-environment node
import { describe, expect, it } from "vitest";

import { findDuplicatePairs, localDate, pickMatch, titleSimilarity, titlesMatch } from "./match";

const TZ = "America/New_York";
const at = (iso: string) => new Date(iso);

describe("title matching", () => {
  it("ignores case, punctuation, accents and stop words", () => {
    expect(titleSimilarity("Workshop 3: Tool Use", "workshop 3 - tool use")).toBe(1);
    expect(titlesMatch("Café Session", "Cafe Session").match).toBe(true);
  });

  it("matches when one title contains the other", () => {
    expect(titlesMatch("Prompting office hours", "CBC Prompting Office Hours (Fall)").match).toBe(
      true,
    );
  });

  it("does not match two different sessions", () => {
    expect(titlesMatch("Workshop 3: Tool Use", "Welcome Social: Board Games").match).toBe(false);
  });
});

describe("pickMatch", () => {
  const session = { title: "Workshop 3: Tool Use", startsAt: at("2026-09-10T22:03:00Z") };

  it("links the single candidate on the same local day within 90 minutes", () => {
    const result = pickMatch(
      session,
      [
        {
          id: "e1",
          title: "Workshop 3: Tool Use and Function Calling",
          startsAt: at("2026-09-10T22:00:00Z"),
        },
      ],
      TZ,
    );
    expect(result).toMatchObject({ kind: "matched", eventId: "e1" });
  });

  it("flags several candidates for review instead of guessing", () => {
    const result = pickMatch(
      session,
      [
        { id: "e1", title: "Workshop 3: Tool Use", startsAt: at("2026-09-10T22:00:00Z") },
        { id: "e2", title: "Workshop 3: Tool Use", startsAt: at("2026-09-10T23:00:00Z") },
      ],
      TZ,
    );
    expect(result.kind).toBe("ambiguous");
    expect(result.kind === "ambiguous" && result.candidates).toHaveLength(2);
  });

  it("does not match outside the 90-minute window or across the local day", () => {
    expect(
      pickMatch(
        session,
        [{ id: "e1", title: "Workshop 3: Tool Use", startsAt: at("2026-09-11T02:00:00Z") }],
        TZ,
      ).kind,
    ).toBe("none");
    // 2026-09-11T02:00Z is 22:00 on Sep 10 in New York but more than 90 minutes away.
    expect(
      pickMatch(
        { title: "Late Session", startsAt: at("2026-09-11T03:30:00Z") },
        [{ id: "e1", title: "Late Session", startsAt: at("2026-09-11T04:30:00Z") }],
        TZ,
      ).kind,
    ).toBe("none");
  });

  it("returns none when nothing matches", () => {
    expect(
      pickMatch(
        session,
        [{ id: "e1", title: "Board meeting", startsAt: at("2026-09-10T22:00:00Z") }],
        TZ,
      ).kind,
    ).toBe("none");
  });
});

describe("localDate", () => {
  it("uses the org timezone, not UTC", () => {
    expect(localDate(at("2026-09-11T03:00:00Z"), TZ)).toBe("2026-09-10");
    expect(localDate(at("2026-09-11T03:00:00Z"), "UTC")).toBe("2026-09-11");
  });
});

describe("findDuplicatePairs", () => {
  it("pairs sessions on the same local day, close in time, with matching titles", () => {
    const pairs = findDuplicatePairs(
      [
        { id: "a", title: "Prompting office hours", startsAt: at("2026-09-22T13:58:00Z") },
        { id: "b", title: "Prompting Office Hours", startsAt: at("2026-09-22T14:15:00Z") },
        { id: "c", title: "Weekly exec sync", startsAt: at("2026-09-22T23:30:00Z") },
      ],
      TZ,
    );
    expect(pairs).toEqual([{ a: "a", b: "b", score: 1 }]);
  });

  it("finds nothing among distinct sessions", () => {
    expect(
      findDuplicatePairs(
        [
          { id: "a", title: "Workshop 1", startsAt: at("2026-09-03T22:00:00Z") },
          { id: "b", title: "Workshop 2", startsAt: at("2026-09-10T22:00:00Z") },
        ],
        TZ,
      ),
    ).toEqual([]);
  });
});
