import { describe, expect, it } from "vitest";

import {
  mergeDuplicates,
  mergePlan,
  needsReport,
  rowsToFix,
  suggestedKeep,
  syncStopped,
} from "./databases";

const ev = (id: string, attendanceCount = 0, sourceSessionId: string | null = null) => ({
  id,
  attendanceCount,
  sourceSessionId,
});

describe("which session a merge keeps", () => {
  it("keeps the one with more check-ins", () => {
    expect(suggestedKeep(ev("a", 3), ev("b", 9)).keep.id).toBe("b");
  });
  it("keeps the website's one on a tie", () => {
    expect(suggestedKeep(ev("a", 4, "s1"), ev("b", 4)).keep.id).toBe("a");
    expect(suggestedKeep(ev("a", 4), ev("b", 4, "s2")).keep.id).toBe("b");
  });
});

describe("Merge N", () => {
  const events = [ev("a", 5), ev("b", 1), ev("c", 2), ev("d"), ev("e", 1)];
  it("merges each session once, surest pairs first", () => {
    const plan = mergePlan(
      [
        { a: "a", b: "b", score: 0.8 },
        { a: "b", b: "c", score: 0.95 },
        { a: "d", b: "e", score: 0.9 },
      ],
      events,
    );
    expect(plan).toEqual([
      { survivorId: "c", loserId: "b" },
      { survivorId: "e", loserId: "d" },
    ]);
  });
  it("skips a pair whose session is gone", () => {
    expect(mergePlan([{ a: "a", b: "zz", score: 1 }], events)).toEqual([]);
  });
  it("shows for admins with pairs, and counts them", () => {
    const pairs = [
      { a: "a", b: "b", score: 1 },
      { a: "d", b: "e", score: 1 },
    ];
    expect(mergeDuplicates(pairs, events, true)?.count).toBe(2);
    expect(mergeDuplicates(pairs, events, false)).toBeNull();
    expect(mergeDuplicates([], events, true)).toBeNull();
    expect(mergeDuplicates(pairs.slice(0, 1), events, true)?.reason).toBe(
      "Same day, same time, same title",
    );
  });
});

describe("Fix N rows", () => {
  it("counts each skipped line once, after the import", () => {
    const issues = [
      { line: 3, message: "The email is not an address." },
      { line: 3, message: "Unreadable check-in time." },
      { line: 7, message: "Each row needs an email or a name." },
    ];
    expect(rowsToFix(issues, true)).toEqual({ count: 2, reason: "2 rows were skipped" });
    expect(rowsToFix(issues, false)).toBeNull();
  });
  it("ignores whole-file problems and clean imports", () => {
    expect(rowsToFix([{ line: 1, message: "Add a session column." }], true)).toBeNull();
    expect(rowsToFix([], true)).toBeNull();
    expect(rowsToFix(undefined, true)).toBeNull();
  });
});

describe("Make a report", () => {
  it("shows for a database with rows and no report", () => {
    expect(needsReport({ canReport: true, hasReport: false, rows: 4 })).not.toBeNull();
    expect(needsReport({ canReport: true, hasReport: true, rows: 4 })).toBeNull();
    expect(needsReport({ canReport: true, hasReport: false, rows: 0 })).toBeNull();
    expect(needsReport({ canReport: false, hasReport: false, rows: 4 })).toBeNull();
  });
});

describe("Reconnect the website sync", () => {
  it("shows when it stopped or needs signing in", () => {
    expect(syncStopped({ status: "ERROR", lastError: "timeout" })).not.toBeNull();
    expect(syncStopped({ status: "NEEDS_REAUTH", lastError: null })).not.toBeNull();
    expect(syncStopped({ status: "CONNECTED", lastError: null })).toBeNull();
    expect(syncStopped(null)).toBeNull();
  });
});
