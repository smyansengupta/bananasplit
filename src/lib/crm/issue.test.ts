import { describe, expect, it } from "vitest";

import {
  countsForIssue,
  issueAfterRefresh,
  issueDigest,
  issueFromAnswer,
  IssueOutput,
  issueSourceLabel,
  issueSources,
  parseStoredIssue,
  readIssue,
  shouldRefreshIssue,
  type IssueSource,
  type StoredIssue,
} from "./issue";

const at = (d: string) => new Date(`${d}T12:00:00Z`);
const entries: IssueSource[] = [
  {
    id: "a1",
    kind: "NOTE",
    subject: null,
    body: "Hates the new export",
    occurredAt: at("2026-10-30"),
  },
  {
    id: "a2",
    kind: "EMAIL",
    direction: "OUTBOUND",
    subject: "Hi",
    body: "Our pitch",
    occurredAt: at("2026-11-01"),
  },
  {
    id: "a3",
    kind: "EMAIL",
    direction: "INBOUND",
    subject: "Re: Hi",
    body: "Export still slow",
    occurredAt: at("2026-11-02"),
  },
  { id: "a4", kind: "STAGE_CHANGE", subject: "Moved", body: null, occurredAt: at("2026-11-02") },
  { id: "a5", kind: "CALL", subject: "Call", body: "", occurredAt: at("2026-10-01") },
  { id: "a6", kind: "NOTE", subject: null, body: "   ", occurredAt: at("2026-11-03") },
];

describe("what an issue is read from", () => {
  it("counts notes, calls, meetings and what they sent us, never what we sent", () => {
    expect(countsForIssue("NOTE", null)).toBe(true);
    expect(countsForIssue("MEETING", null)).toBe(true);
    expect(countsForIssue("EMAIL", "INBOUND")).toBe(true);
    expect(countsForIssue("TEXT", "INBOUND")).toBe(true);
    expect(countsForIssue("EMAIL", "OUTBOUND")).toBe(false);
    expect(countsForIssue("STAGE_CHANGE", null)).toBe(false);
  });

  it("keeps the ones with words in them, newest first", () => {
    expect(issueSources(entries).map((e) => e.id)).toEqual(["a3", "a1", "a5"]);
  });
});

describe("refresh rules", () => {
  const sources = issueSources(entries);
  const digest = issueDigest(sources);

  it("gives the same digest for the same content, and a new one when a note changes", () => {
    expect(issueDigest(issueSources([...entries].reverse()))).toBe(digest);
    const edited = entries.map((e) =>
      e.id === "a1" ? { ...e, body: "Loves the new export now" } : e,
    );
    expect(issueDigest(issueSources(edited))).not.toBe(digest);
    const added = [
      ...entries,
      { id: "a7", kind: "NOTE", subject: null, body: "New", occurredAt: at("2026-11-03") },
    ];
    expect(issueDigest(issueSources(added))).not.toBe(digest);
  });

  it("asks the AI only when there's something to read and it changed, or someone asked", () => {
    expect(shouldRefreshIssue(undefined, digest, 3)).toEqual({ refresh: true, why: "changed" });
    expect(shouldRefreshIssue("old", digest, 3)).toEqual({ refresh: true, why: "changed" });
    expect(shouldRefreshIssue(digest, digest, 3)).toEqual({ refresh: false, why: "same" });
    expect(shouldRefreshIssue(digest, digest, 3, { force: true })).toEqual({
      refresh: true,
      why: "asked",
    });
    expect(shouldRefreshIssue(undefined, issueDigest([]), 0, { force: true })).toEqual({
      refresh: false,
      why: "empty",
    });
  });
});

describe("the stored shape", () => {
  const now = new Date("2026-11-03T15:00:00Z");

  it("takes the model's line and only the sources it was shown", () => {
    const answer = {
      issue: '"Finds the new export too slow for monthly reports"',
      sourceIds: ["a3", "a1", "zz", "a3"],
      notes: [],
    };
    expect(IssueOutput.parse(answer)).toEqual(answer);
    expect(
      issueFromAnswer(answer, { validIds: ["a1", "a3", "a5"], model: "claude-haiku", now }),
    ).toEqual({
      text: "Finds the new export too slow for monthly reports",
      at: now.toISOString(),
      model: "claude-haiku",
      sources: ["a3", "a1"],
    });
  });

  it("reads 'none' and empty answers as no issue", () => {
    for (const issue of [null, "", "  ", "None", "No clear issue found."]) {
      expect(
        issueFromAnswer({ issue, sourceIds: [], notes: [] }, { validIds: [], model: null, now }),
      ).toBeNull();
    }
  });

  it("keeps one line under the cap", () => {
    const r = issueFromAnswer(
      { issue: `Slow\nexport ${"x".repeat(300)}`, sourceIds: [], notes: [] },
      { validIds: [], model: null, now },
    );
    expect(r!.text.startsWith("Slow export")).toBe(true);
    expect(r!.text.length).toBeLessThanOrEqual(160);
  });

  it("parses exactly { text, at, model, sources } off the enrichment, and nothing broken", () => {
    const stored: StoredIssue = {
      text: "Too slow",
      at: now.toISOString(),
      model: null,
      sources: ["a1"],
    };
    expect(readIssue({ _issue: stored, _summary: {} })).toEqual(stored);
    expect(readIssue({})).toBeNull();
    expect(parseStoredIssue({ text: "", at: now.toISOString() })).toBeNull();
    expect(parseStoredIssue({ text: "x", at: "not a date" })).toBeNull();
    expect(
      parseStoredIssue({ text: "x", at: now.toISOString(), sources: ["ok", "bad id!", 3] }),
    ).toEqual({
      text: "x",
      at: now.toISOString(),
      model: null,
      sources: ["ok"],
    });
  });

  it("keeps a member's own line when the AI finds nothing, and drops an old AI one", () => {
    const mine: StoredIssue = { text: "Mine", at: now.toISOString(), model: null, sources: [] };
    const ai: StoredIssue = { ...mine, text: "AI", model: "claude-haiku", sources: ["a1"] };
    expect(issueAfterRefresh(mine, null)).toBe(mine);
    expect(issueAfterRefresh(ai, null)).toBeNull();
    expect(issueAfterRefresh(mine, ai)).toBe(ai);
  });
});

describe("issueSourceLabel", () => {
  it("says where it came from", () => {
    const ai = { model: "m", sources: ["a1", "a3", "a5"] };
    expect(
      issueSourceLabel(ai, [
        { kind: "NOTE" },
        { kind: "NOTE" },
        { kind: "EMAIL", direction: "INBOUND" },
      ]),
    ).toBe("From 2 notes and a reply");
    expect(
      issueSourceLabel(ai, [
        { kind: "CALL" },
        { kind: "MEETING" },
        { kind: "TEXT", direction: "INBOUND" },
      ]),
    ).toBe("From a reply, a call and a meeting");
    expect(issueSourceLabel(ai, [])).toBe("From their timeline");
    expect(issueSourceLabel({ model: null, sources: [] }, [])).toBe("Written by hand");
  });
});
