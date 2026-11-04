// @vitest-environment node
import { describe, expect, it } from "vitest";

import { crmRecordHref } from "./href";
import { formatOpen, hrefWithOpen, parseOpen, rendersOverlays } from "./overlay";
import { powerHourBackLabel, powerHourMinutes, powerHourSnoozeUntil } from "./power-hour";

describe("the ?open= contract", () => {
  it("reads every card kind", () => {
    expect(parseOpen("person:abc123")).toEqual({ kind: "person", id: "abc123" });
    expect(parseOpen("company:c_1")).toEqual({ kind: "company", id: "c_1" });
    expect(parseOpen("deal:d-9")).toEqual({ kind: "deal", id: "d-9" });
    expect(parseOpen("power")).toEqual({ kind: "power" });
    expect(parseOpen("log")).toEqual({ kind: "log" });
    expect(parseOpen("ask")).toEqual({ kind: "ask" });
    expect(parseOpen("calls")).toEqual({ kind: "calls" });
    expect(parseOpen("text:t_1")).toEqual({ kind: "text", id: "t_1" });
    expect(parseOpen("new:person")).toEqual({ kind: "new", what: "person" });
    expect(parseOpen("new:deal")).toEqual({ kind: "new", what: "deal" });
    expect(parseOpen("goal")).toEqual({ kind: "goal", id: null });
    expect(parseOpen("goal:g1")).toEqual({ kind: "goal", id: "g1" });
    expect(parseOpen("merge:a1,b2")).toEqual({ kind: "merge", ids: ["a1", "b2"] });
    expect(parseOpen("quote:q1")).toEqual({ kind: "quote", id: "q1" });
    expect(formatOpen({ kind: "quote", id: "q1" })).toBe("quote:q1");
  });

  it("merges two different records, or asks for the second", () => {
    expect(parseOpen("merge")).toBeNull();
    expect(parseOpen("merge:a1")).toEqual({ kind: "merge", ids: ["a1"] });
    expect(formatOpen({ kind: "merge", ids: ["a1"] })).toBe("merge:a1");
    expect(parseOpen("merge:a1,a1")).toBeNull();
    expect(parseOpen("merge:a1,b2,c3")).toBeNull();
    expect(parseOpen("merge:a1,<b>")).toBeNull();
  });

  it("opens nothing for what it doesn't know", () => {
    expect(parseOpen(undefined)).toBeNull();
    expect(parseOpen("")).toBeNull();
    expect(parseOpen("person")).toBeNull();
    expect(parseOpen("person:")).toBeNull();
    expect(parseOpen("person:a b")).toBeNull();
    expect(parseOpen("person:<script>")).toBeNull();
    expect(parseOpen("new:meeting")).toBeNull();
    expect(parseOpen("power:1")).toBeNull();
    expect(parseOpen("calls:1")).toBeNull();
    expect(parseOpen("text:")).toBeNull();
    expect(parseOpen("club:1")).toBeNull();
  });

  it("takes the first of a repeated param", () => {
    expect(parseOpen(["log", "power"])).toEqual({ kind: "log" });
  });

  it("writes what it reads", () => {
    for (const v of [
      "person:a1",
      "company:b2",
      "deal:c3",
      "power",
      "log",
      "ask",
      "calls",
      "text:t1",
      "new:company",
      "goal",
      "goal:g2",
      "merge:a1,b2",
      "plan:sequence:s1",
      "plan:campaign:c_2",
      "plan:email",
      "plan:split",
    ]) {
      expect(formatOpen(parseOpen(v)!)).toBe(v);
    }
  });

  it("reads an outreach plan, and nothing it doesn't know", () => {
    expect(parseOpen("plan:sequence:s1")).toEqual({ kind: "plan", type: "sequence", id: "s1" });
    expect(parseOpen("plan:email")).toEqual({ kind: "plan", type: "email", id: null });
    expect(parseOpen("plan")).toBeNull();
    expect(parseOpen("plan:sequence")).toBeNull();
    expect(parseOpen("plan:sequence:")).toBeNull();
    expect(parseOpen("plan:list:l1")).toBeNull();
    expect(parseOpen("plan:campaign:a b")).toBeNull();
    expect(parseOpen("plan:email:x")).toBeNull();
  });

  it("sets and removes open, keeping the rest of the URL", () => {
    expect(hrefWithOpen("/app/o/crm", "who=all&q=nora", { kind: "person", id: "p1" })).toBe(
      "/app/o/crm?who=all&q=nora&open=person%3Ap1",
    );
    expect(hrefWithOpen("/app/o/crm", "?who=all&open=log", null)).toBe("/app/o/crm?who=all");
    expect(hrefWithOpen("/app/o/crm", "open=log", null)).toBe("/app/o/crm");
    expect(hrefWithOpen("/app/o/crm", { view: "companies", tag: ["a", "b"] }, "power")).toBe(
      "/app/o/crm?view=companies&tag=a&tag=b&open=power",
    );
    expect(hrefWithOpen("/app/o/crm", new URLSearchParams("open=power"), "log")).toBe(
      "/app/o/crm?open=log",
    );
  });

  it("links a record to its list with its card open", () => {
    expect(crmRecordHref("o", "person", "p1")).toBe("/app/o/crm/people?open=person%3Ap1");
    expect(crmRecordHref("o", "company", "c1")).toBe(
      "/app/o/crm/people?view=companies&open=company%3Ac1",
    );
    expect(crmRecordHref("o", "deal", "d1")).toBe("/app/o/crm/people?view=board&open=deal%3Ad1");
    expect(
      parseOpen(
        new URL(`https://x${crmRecordHref("o", "company", "c1")}`).searchParams.get("open"),
      ),
    ).toEqual({ kind: "company", id: "c1" });
  });
});

describe("pages that open cards in place", () => {
  it("are the tabs and a settings section", () => {
    for (const p of ["/app/o/crm", "/app/o/crm/people", "/app/o/crm/settings/automations"]) {
      expect(rendersOverlays(p)).toBe(true);
    }
    for (const p of [
      "/app/o/crm/settings",
      "/app/o/crm/settings/automations/w1",
      // Only redirect now.
      "/app/o/crm/companies",
      "/app/o/crm/pipelines/p1",
      "/app/o/crm/deals",
      "/app/o/crm/outreach",
      "/app/o/crm/outreach/sequences",
      "/app/o/crm/campaigns/c1",
      "/app/o/inbox",
      "/app/o/crm/people/p1",
    ]) {
      expect(rendersOverlays(p)).toBe(false);
    }
  });
});

describe("Power hour", () => {
  const tz = "America/New_York";

  it("snoozes a morning until 2 PM the same day", () => {
    const now = new Date("2026-11-03T14:30:00Z"); // 9:30 AM in New York
    expect(powerHourSnoozeUntil(now, tz).toISOString()).toBe("2026-11-03T19:00:00.000Z");
    expect(powerHourBackLabel(powerHourSnoozeUntil(now, tz), now, tz)).toBe(
      "Power hour is back at 2 PM",
    );
  });

  it("snoozes an afternoon until the next morning", () => {
    const now = new Date("2026-11-03T20:00:00Z"); // 3 PM in New York
    expect(powerHourSnoozeUntil(now, tz).toISOString()).toBe("2026-11-04T13:00:00.000Z");
    expect(powerHourBackLabel(powerHourSnoozeUntil(now, tz), now, tz)).toBe(
      "Power hour is back tomorrow morning",
    );
  });

  it("reads the hour where the member is", () => {
    // 1 PM in Tokyo is 4 AM UTC: still before 2 PM there.
    const now = new Date("2026-11-03T04:00:00Z");
    expect(powerHourSnoozeUntil(now, "Asia/Tokyo").toISOString()).toBe("2026-11-03T05:00:00.000Z");
  });

  it("guesses minutes, rounded to five", () => {
    expect(powerHourMinutes(0)).toBe(0);
    expect(powerHourMinutes(1)).toBe(5);
    expect(powerHourMinutes(4)).toBe(25);
    expect(powerHourMinutes(10)).toBe(60);
  });
});
