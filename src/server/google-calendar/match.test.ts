import { describe, expect, it } from "vitest";

import type { ImportedEvent } from "./mapping";
import { planImport, summarize, titleSimilarity, type SuiteCandidate } from "./match";

const CAL = "club@group.calendar.google.com";
const ORG = "org_cbc";

function g(id: string, title: string, start: string, extra: Partial<ImportedEvent> = {}): ImportedEvent {
  const startsAt = new Date(start);
  return {
    googleEventId: id,
    etag: null,
    htmlLink: null,
    mirrorOf: null,
    title,
    description: null,
    location: null,
    rsvpUrl: null,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 90 * 60 * 1000),
    allDay: false,
    kind: "WORKSHOP",
    ...extra,
  };
}

function s(id: string, title: string, start: string, extra: Partial<SuiteCandidate> = {}): SuiteCandidate {
  const startsAt = new Date(start);
  return {
    id,
    title,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 90 * 60 * 1000),
    googleCalendarId: null,
    googleEventId: null,
    deletedAt: null,
    mergedIntoId: null,
    ...extra,
  };
}

describe("import matching", () => {
  it("links a workshop the website sync already created instead of duplicating it", () => {
    const decisions = planImport(
      [g("g_w1", "Workshop 1: Prompting Fundamentals", "2026-09-09T22:00:00Z")],
      [s("e_w1", "Workshop 1 - Prompting Fundamentals", "2026-09-09T22:00:00Z")],
      { organizationId: ORG, calendarId: CAL },
    );
    expect(decisions).toEqual([expect.objectContaining({ action: "link", suiteEventId: "e_w1" })]);
  });

  it("prefers the closer of two sessions when one clearly wins", () => {
    const decisions = planImport(
      [g("g_info", "Info Session", "2026-09-17T22:00:00Z")],
      [
        s("e_info6", "Info Session (6:00pm Slot)", "2026-09-17T22:00:00Z"),
        s("e_info7", "Info Session (7:00pm Slot)", "2026-09-17T23:00:00Z"),
      ],
      { organizationId: ORG, calendarId: CAL },
    );
    expect(decisions[0]).toMatchObject({ action: "link", suiteEventId: "e_info6" });
  });

  it("tolerates a timezone slip of a few hours when the title matches", () => {
    const decisions = planImport(
      [g("g_w2", "Workshop 2: Building with the Claude API", "2026-09-16T18:00:00Z")],
      [s("e_w2", "Workshop 2: Building with the Claude API", "2026-09-16T22:00:00Z")],
      { organizationId: ORG, calendarId: CAL },
    );
    expect(decisions[0]).toMatchObject({ action: "link", suiteEventId: "e_w2" });
  });

  it("queues an event with several close candidates as ambiguous", () => {
    const decisions = planImport(
      [g("g_info", "Info Session", "2026-09-17T22:00:00Z")],
      [
        // The same session twice in the suite (typed in, and synced from the website).
        s("e_info6", "Info Session", "2026-09-17T22:00:00Z"),
        s("e_info7", "Info session", "2026-09-17T22:30:00Z"),
      ],
      { organizationId: ORG, calendarId: CAL },
    );
    expect(decisions[0]).toMatchObject({ action: "ambiguous" });
    expect((decisions[0] as { candidateIds: string[] }).candidateIds.sort()).toEqual(["e_info6", "e_info7"]);
  });

  it("creates events with no candidate, and never matches across a week", () => {
    const decisions = planImport(
      [g("g_new", "Guest talk: Evals", "2026-10-20T22:00:00Z"), g("g_w1b", "Workshop 1", "2026-09-30T22:00:00Z")],
      [s("e_w1", "Workshop 1", "2026-09-09T22:00:00Z")],
      { organizationId: ORG, calendarId: CAL },
    );
    expect(decisions.map((d) => d.action)).toEqual(["create", "create"]);
  });

  it("is a no-op on a re-run: linked events are exact matches", () => {
    const decisions = planImport(
      [g("g_w1", "Workshop 1: Prompting Fundamentals", "2026-09-09T22:00:00Z")],
      [s("e_w1", "Workshop 1", "2026-09-09T22:00:00Z", { googleCalendarId: CAL, googleEventId: "g_w1" })],
      { organizationId: ORG, calendarId: CAL },
    );
    expect(decisions).toEqual([expect.objectContaining({ action: "unchanged", suiteEventId: "e_w1" })]);
    expect(summarize(decisions)).toMatchObject({ unchanged: 1, linked: 0, created: 0, ambiguous: 0 });
  });

  it("relinks the suite's own mirror and never imports another org's or a deleted event's", () => {
    const decisions = planImport(
      [
        g("mirror_ok", "Workshop 5", "2026-10-01T22:00:00Z", { mirrorOf: { suiteEventId: "e5", orgId: ORG } }),
        g("mirror_other", "Other", "2026-10-02T22:00:00Z", { mirrorOf: { suiteEventId: "x", orgId: "org_other" } }),
        g("mirror_deleted", "Gone", "2026-10-03T22:00:00Z", { mirrorOf: { suiteEventId: "e_del", orgId: ORG } }),
      ],
      [
        s("e5", "Workshop 5", "2026-10-01T22:00:00Z"),
        s("e_del", "Gone", "2026-10-03T22:00:00Z", { deletedAt: new Date() }),
      ],
      { organizationId: ORG, calendarId: CAL },
    );
    expect(decisions.map((d) => d.action)).toEqual(["relink", "skip", "skip"]);
  });

  it("matches each suite event at most once", () => {
    const decisions = planImport(
      [g("g_a", "Workshop 4: Agents", "2026-09-23T22:00:00Z"), g("g_b", "Workshop 4: Agents", "2026-09-23T22:00:00Z")],
      [s("e4", "Workshop 4: Agents", "2026-09-23T22:00:00Z")],
      { organizationId: ORG, calendarId: CAL },
    );
    expect(decisions.map((d) => d.action).sort()).toEqual(["create", "link"]);
  });

  it("scores titles by token overlap", () => {
    expect(titleSimilarity("Workshop 1: Prompting", "workshop 1 - prompting")).toBe(1);
    expect(titleSimilarity("Workshop 1", "Hackathon")).toBe(0);
  });
});
