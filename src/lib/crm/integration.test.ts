import { describe, expect, it } from "vitest";

import { bookingSlots, OWN_HOURS } from "./outreach/booking";
import { renderMerge } from "./outreach/merge";
import { AUTOMATION_WINDOW, nextInWindow } from "./outreach/schedule";
import { EVERYDAY_STARTERS, STARTER_TEMPLATES, starterFor } from "./outreach/starters";
import { RECIPES } from "./recipes";
import { actionSchema } from "./workflows";

/** The CRM's phases wired together, the pure parts (docs/features/crm.md, "Integration as built"). */

describe("one set of starter templates", () => {
  it("uses outreach's merge fields exactly, every one with a fallback for the person", () => {
    for (const t of STARTER_TEMPLATES) {
      for (const text of [t.subject, t.body]) {
        const r = renderMerge(text, {});
        expect(r.unknown, `${t.name}: ${text}`).toEqual([]);
      }
      // Rendered for someone the CRM knows nothing about, it still reads.
      expect(renderMerge(t.body, { my_first_name: "Ada", organization: "Robotics" }).text).not.toMatch(/\{\{/);
    }
  });

  it("has what each recipe names, and Outreach's everyday three", () => {
    const named = RECIPES.flatMap((r) =>
      r.actions.flatMap((a) => (a.type === "template.send" ? [String(a.params.templateId).replace("@template:", "")] : [])),
    );
    for (const category of named) expect(starterFor(category), category).not.toBeNull();
    expect(EVERYDAY_STARTERS.map((t) => t.category)).toEqual(["follow-up", "thank-you", "invite"]);
  });
});

describe("automation emails", () => {
  it("take a review switch on Send a template and Invite to an event", () => {
    expect(actionSchema.safeParse({ type: "template.send", params: { templateId: "t1", review: true } }).success).toBe(true);
    expect(actionSchema.safeParse({ type: "event.invite", params: { eventId: "e1", review: true } }).success).toBe(true);
    expect(actionSchema.safeParse({ type: "template.send", params: { templateId: "t1", review: "yes" } }).success).toBe(false);
  });

  it("go in waking hours, any day", () => {
    // 3 AM Saturday in New York waits until 8 AM; 10 AM goes now.
    const night = new Date("2026-11-07T08:00:00Z");
    expect(nextInWindow(night, AUTOMATION_WINDOW, "America/New_York").toISOString()).toBe("2026-11-07T13:00:00.000Z");
    const morning = new Date("2026-11-07T15:00:00Z");
    expect(nextInWindow(morning, AUTOMATION_WINDOW, "America/New_York")).toEqual(morning);
  });
});

describe("booking hours", () => {
  const base = {
    tz: "America/New_York",
    durationMin: 60,
    bufferMin: 0,
    minNoticeHours: 0,
    maxDaysAhead: 6,
  };
  // Sunday November 1, 2026, 6 AM in New York.
  const now = new Date("2026-11-01T11:00:00Z");

  it("keeps a host who never set their availability to weekdays 9 to 5", () => {
    const slots = bookingSlots({ ...base, now, hosts: [{ userId: "a", busy: [], events: [] }] });
    const local = slots.map((s) => new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", hourCycle: "h23", timeZone: "America/New_York" }).format(s.start));
    expect(local.some((l) => l.startsWith("Sun"))).toBe(false);
    expect(local.every((l) => Number(l.split(" ")[1]) >= 9 && Number(l.split(" ")[1]) < 17)).toBe(true);
  });

  it("books a host who set it whenever it doesn't say they're busy", () => {
    // Busy Monday mornings (0 = Monday, hours 8 to 11), open otherwise, weekends too.
    const slots = bookingSlots({ ...base, now, hosts: [{ userId: "a", busy: ["0-8", "0-9", "0-10", "0-11"], events: [], ownHours: true }] });
    const at = (iso: string) => slots.some((s) => s.start.toISOString() === iso);
    expect(at("2026-11-01T13:00:00.000Z")).toBe(true); // Sunday 8 AM
    expect(at("2026-11-02T14:00:00.000Z")).toBe(false); // Monday 9 AM: busy
    expect(at("2026-11-02T17:00:00.000Z")).toBe(true); // Monday 12 PM
    expect(at("2026-11-03T02:00:00.000Z")).toBe(true); // Monday 9 PM
    expect(at("2026-11-03T04:00:00.000Z")).toBe(false); // Monday 11 PM: past the grid
    expect(OWN_HOURS.endHour).toBe(23);
  });

  it("holds each host to their own hours when a page has both kinds", () => {
    const slots = bookingSlots({
      ...base,
      now,
      hosts: [
        { userId: "fixed", busy: [], events: [] },
        { userId: "own", busy: ["6-23"], events: [], ownHours: true },
      ],
    });
    const sunday8 = slots.find((s) => s.start.toISOString() === "2026-11-01T13:00:00.000Z");
    expect(sunday8?.hostIds).toEqual(["own"]);
    const monday10 = slots.find((s) => s.start.toISOString() === "2026-11-02T15:00:00.000Z");
    expect(monday10?.hostIds).toEqual(["fixed", "own"]);
  });
});
