// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  audienceChips,
  audienceOffers,
  audienceSet,
  campaignPlanStatus,
  filterPlans,
  funnel,
  previewOf,
  readExtras,
  sequencePlanStatus,
  shortenText,
  sortPlans,
  stepCap,
  stepDays,
  stepsToUi,
  stepTitle,
  textTooLong,
  uiToSteps,
  withExtras,
  type StoredStep,
} from "./plans";

const step = (kind: string, delayDays = 0, extra: Partial<StoredStep> = {}): StoredStep => ({
  kind,
  delayDays,
  delayHours: 0,
  subject: kind === "EMAIL" ? "Hello" : null,
  body: kind === "EMAIL" || kind === "TEXT" ? "Hi {{first_name}}" : null,
  templateId: null,
  taskTitle: kind === "EMAIL" || kind === "TEXT" ? null : "Call them",
  ...extra,
});

describe("plan statuses", () => {
  it("reads a sequence's and a campaign's status as a plan's", () => {
    expect(sequencePlanStatus("ON")).toBe("running");
    expect(sequencePlanStatus("OFF")).toBe("paused");
    expect(sequencePlanStatus("DRAFT")).toBe("draft");
    expect(campaignPlanStatus("ACTIVE")).toBe("running");
    expect(campaignPlanStatus("DONE")).toBe("done");
    expect(campaignPlanStatus("DRAFT")).toBe("draft");
  });
});

describe("steps as the card edits them", () => {
  const stored = [step("EMAIL"), step("EMAIL", 3), step("TEXT", 2), step("CALL", 1)];

  it("draws each delay as a wait before its step", () => {
    const ui = stepsToUi(stored);
    expect(ui.map((s) => s.kind)).toEqual([
      "email",
      "wait",
      "email",
      "wait",
      "text",
      "wait",
      "call",
    ]);
    expect(ui[1]).toMatchObject({ kind: "wait", days: 3 });
  });

  it("round-trips", () => {
    expect(uiToSteps(stepsToUi(stored))).toEqual(stored);
  });

  it("folds waits into the next step and drops a trailing one", () => {
    const back = uiToSteps([
      { key: "a", kind: "wait", days: 1 },
      { key: "b", kind: "wait", days: 2, hours: 30 },
      { key: "c", kind: "task", title: " Ask about shifts " },
      { key: "d", kind: "wait", days: 4 },
    ]);
    expect(back).toEqual([
      {
        kind: "TASK",
        delayDays: 4,
        delayHours: 6,
        subject: null,
        body: null,
        templateId: null,
        taskTitle: "Ask about shifts",
      },
    ]);
  });

  it("counts the day each step happens", () => {
    expect(stepDays(stepsToUi(stored))).toEqual([0, null, 3, null, 5, null, 6]);
  });

  it("names steps in plain words", () => {
    const ui = stepsToUi(stored);
    expect(stepTitle(ui[0]!)).toBe("Email");
    expect(stepTitle(ui[1]!)).toBe("Wait 3 days");
    expect(stepTitle(ui[4]!, ui[3]!)).toBe("Text if no reply");
    expect(stepTitle(ui[6]!, ui[5]!)).toBe("Task: call");
    expect(stepTitle({ key: "w", kind: "wait", days: 1 })).toBe("Wait 1 day");
  });

  it("previews the first three steps with their day", () => {
    expect(previewOf(stored)).toEqual([
      { what: "Hello", when: "Day 0", kind: "email" },
      { what: "Hello", when: "Day 3", kind: "email" },
      { what: "Text", when: "Day 5", kind: "text" },
    ]);
  });
});

describe("texts", () => {
  it("knows when a text splits in two", () => {
    expect(textTooLong("a".repeat(160))).toBe(false);
    expect(textTooLong("a".repeat(161))).toBe(true);
  });

  it("shortens to whole sentences, never adding words", () => {
    const long =
      "Hi Ellen, it is Jackson from Northside Makers. Did our thank-you reach you? Your gift ran the Saturday workshops this year, and we would love to see you at the showcase in December.";
    const short = shortenText(long);
    expect(short.length).toBeLessThanOrEqual(160);
    expect(short).toBe(
      "Hi Ellen, it is Jackson from Northside Makers. Did our thank-you reach you?",
    );
    expect(long.startsWith(short)).toBe(true);
  });

  it("cuts one long sentence at a word", () => {
    const short = shortenText(`${"word ".repeat(60)}end`);
    expect(short.length).toBeLessThanOrEqual(160);
    expect(short.endsWith("…")).toBe(true);
  });
});

describe("the list", () => {
  const plans = [
    { name: "Donor check-in", status: "running" as const, who: "Donors", updatedAt: "2026-11-01" },
    { name: "Welcome", status: "draft" as const, who: "New members", updatedAt: "2026-11-03" },
    { name: "Showcase invite", status: "done" as const, who: "Everyone", updatedAt: "2026-11-02" },
    { name: "Renewals", status: "running" as const, who: "Clients", updatedAt: "2026-11-02" },
  ];

  it("filters by status and search", () => {
    expect(filterPlans(plans, { status: "running" }).map((p) => p.name)).toEqual([
      "Donor check-in",
      "Renewals",
    ]);
    expect(filterPlans(plans, { q: "donor" }).map((p) => p.name)).toEqual(["Donor check-in"]);
    expect(filterPlans(plans, { q: "members" }).map((p) => p.name)).toEqual(["Welcome"]);
  });

  it("puts running first, newest first", () => {
    expect(sortPlans(plans).map((p) => p.name)).toEqual([
      "Renewals",
      "Donor check-in",
      "Welcome",
      "Showcase invite",
    ]);
  });
});

describe("results", () => {
  it("draws bars against the first and percentages of it", () => {
    expect(
      funnel([
        { label: "Sent", n: 38 },
        { label: "Opened", n: 19 },
        { label: "Replied", n: 0 },
      ]),
    ).toEqual([
      { label: "Sent", n: 38, pct: "", share: 1 },
      { label: "Opened", n: 19, pct: "50%", share: 0.5 },
      { label: "Replied", n: 0, pct: "0%", share: 0 },
    ]);
    expect(
      funnel([
        { label: "Sent", n: 0 },
        { label: "Replied", n: 0 },
      ])[1],
    ).toEqual({ label: "Replied", n: 0, pct: "", share: 0 });
  });
});

describe("who and settings", () => {
  const names = {
    relationships: new Map([["r1", "Donors"]]),
    members: new Map([["u1", "Kristine"]]),
  };

  it("says who in chips", () => {
    expect(
      audienceChips({ relationship: "r1", due: "cold", owner: "me" }, names).map((c) => c.label),
    ).toEqual(["Donors", "gone quiet", "mine"]);
    expect(audienceChips({ owner: "u1", status: "ALUMNI" }, names).map((c) => c.label)).toEqual([
      "past members",
      "owned by Kristine",
    ]);
    expect(audienceChips({}, names)).toEqual([]);
  });

  it("offers what isn't set", () => {
    const offers = audienceOffers({ due: "cold" }, [{ id: "r1", label: "Donors" }]);
    expect(offers.map((o) => o.label)).toEqual(["Donors", "mine"]);
    expect(audienceSet({})).toBe(false);
    expect(audienceSet({ status: "ACTIVE" })).toBe(false);
    expect(audienceSet({ due: "new" })).toBe(true);
  });

  it("keeps a plan's settings beside the send window, cleaned", () => {
    const window = { days: [1, 2, 3, 4, 5], startHour: 9, endHour: 17 };
    const stored = withExtras(window, {
      from: "owner",
      dailyCap: 40,
      who: { relationship: "r1", due: "cold", owner: null },
      include: ["p1", "p1", "bad id"],
    });
    expect(stored).toMatchObject(window);
    const back = readExtras(stored);
    expect(back).toEqual({
      from: "owner",
      dailyCap: 40,
      who: { relationship: "r1", owner: null, due: "cold", status: null },
      include: ["p1"],
    });
    expect(readExtras(window)).toEqual({ from: "me", dailyCap: null, who: {}, include: [] });
    expect(
      readExtras({
        plan: { from: "x", dailyCap: -3, who: { due: "soon", relationship: "<script>" } },
      }),
    ).toEqual({
      from: "me",
      dailyCap: null,
      who: { relationship: null, owner: null, due: null, status: null },
      include: [],
    });
  });

  it("steps the daily cap by ten, between 10 and 200", () => {
    expect(stepCap(null, 10, 150)).toBe(160);
    expect(stepCap(40, -10, 150)).toBe(30);
    expect(stepCap(10, -10, 150)).toBe(10);
    expect(stepCap(200, 10, 150)).toBe(200);
    expect(stepCap(null, -10, 500)).toBe(190);
  });
});
