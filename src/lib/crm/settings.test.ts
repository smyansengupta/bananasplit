import { describe, expect, it } from "vitest";

import { nextInWindow } from "./outreach/schedule";
import { planOwners, setupSummary, startingKinds } from "./setup-owners";
import {
  automationEmailReview,
  DEFAULT_SENDING,
  DEFAULT_UNSUBSCRIBE_LINE,
  hourLabel,
  readAutonomy,
  readSending,
  sendingIsSet,
  sendingPauses,
  sendingWindow,
  TRUST_ITEMS,
  unsubscribeFooter,
} from "./settings-prefs";
import {
  canOpenSection,
  CRM_SETTINGS_SECTIONS,
  defaultSection,
  findSection,
  visibleSections,
} from "./settings-sections";

const admin = { admin: true, manager: true, personal: false };
const manager = { admin: false, manager: true, personal: false };
const member = { admin: false, manager: false, personal: false };
const personal = { admin: true, manager: true, personal: true };

describe("CRM settings sections", () => {
  it("shows owners and admins everything, in the mockup's order", () => {
    expect(visibleSections(admin).map((s) => s.id)).toEqual(CRM_SETTINGS_SECTIONS.map((s) => s.id));
    expect(visibleSections(admin)[0]!.id).toBe("you");
  });

  it("gives managers the CRM's own sections, not phone, team or API", () => {
    const ids = visibleSections(manager).map((s) => s.id);
    expect(ids).toContain("automations");
    expect(ids).toContain("stages");
    expect(ids).not.toContain("phone");
    expect(ids).not.toContain("team");
    expect(ids).not.toContain("api");
    // Handing people over is theirs too, though Team and access isn't.
    expect(ids).toContain("handover");
    expect(canOpenSection(findSection("handover")!, member)).toBe(false);
  });

  it("gives every member their own sections only", () => {
    expect(visibleSections(member).map((s) => s.id)).toEqual(["you", "templates", "booking"]);
  });

  it("hides Team and access in a Personal space", () => {
    const ids = visibleSections(personal).map((s) => s.id);
    expect(ids).not.toContain("team");
    expect(ids).not.toContain("handover");
    expect(ids).toContain("api");
    expect(canOpenSection(findSection("team")!, personal)).toBe(false);
  });

  it("opens on Automations for whoever runs it, else You", () => {
    expect(defaultSection(admin)).toBe("automations");
    expect(defaultSection(manager)).toBe("automations");
    expect(defaultSection(member)).toBe("you");
  });

  it("maps the old sub-pages onto their sections", () => {
    expect(findSection("webhooks")!.id).toBe("api");
    expect(findSection("handover")!.id).toBe("handover");
    expect(findSection("phone")!.id).toBe("phone");
    expect(findSection("nope")).toBeNull();
  });
});

describe("Sending prefs", () => {
  it("falls back to the defaults for anything odd", () => {
    expect(readSending(null)).toEqual(DEFAULT_SENDING);
    expect(readSending({ startHour: 18, endHour: 9 })).toMatchObject({ startHour: 8, endHour: 21 });
    expect(readSending({ startHour: 9.5, weekends: "no", unsubscribeLine: "   " })).toEqual(
      DEFAULT_SENDING,
    );
    expect(
      readSending({
        startHour: 9,
        endHour: 18,
        weekends: false,
        unsubscribeLine: " Not for you?  Unsubscribe. ",
      }),
    ).toEqual({
      startHour: 9,
      endHour: 18,
      weekends: false,
      unsubscribeLine: "Not for you? Unsubscribe.",
    });
  });

  it("knows whether anything was set", () => {
    expect(sendingIsSet({})).toBe(false);
    expect(sendingIsSet(null)).toBe(false);
    expect(sendingIsSet({ weekends: false })).toBe(true);
  });

  it("turns into a window that waits for Monday when weekends are off", () => {
    const w = sendingWindow(readSending({ startHour: 9, endHour: 18, weekends: false }));
    expect(w).toEqual({ days: [1, 2, 3, 4, 5], startHour: 9, endHour: 18 });
    // Saturday 2026-11-07, noon in New York: waits for Monday 9 AM there.
    const at = nextInWindow(new Date("2026-11-07T17:00:00Z"), w, "America/New_York");
    expect(at.toISOString()).toBe("2026-11-09T14:00:00.000Z");
  });

  it("labels hours", () => {
    expect(hourLabel(0)).toBe("12 AM");
    expect(hourLabel(9)).toBe("9 AM");
    expect(hourLabel(12)).toBe("12 PM");
    expect(hourLabel(18)).toBe("6 PM");
    expect(hourLabel(24)).toBe("12 AM");
  });

  it("links the unsubscribe word, and always has one", () => {
    const d = unsubscribeFooter(DEFAULT_UNSUBSCRIBE_LINE, "https://x.test/u?a=1&b=2");
    expect(d.text).toBe("Don't want these emails? Unsubscribe: https://x.test/u?a=1&b=2");
    expect(d.html).toBe(
      `Don't want these emails? <a href="https://x.test/u?a=1&amp;b=2">Unsubscribe</a>.`,
    );
    const custom = unsubscribeFooter("Not for you? <b>Leave</b>", "https://x.test/u");
    expect(custom.html).toBe(
      `Not for you? &lt;b&gt;Leave&lt;/b&gt; <a href="https://x.test/u">Unsubscribe</a>.`,
    );
    expect(custom.text).toBe("Not for you? <b>Leave</b> Unsubscribe: https://x.test/u");
  });
});

describe("How much it may do alone", () => {
  it("fills each item's fallback", () => {
    expect(readAutonomy(undefined)).toEqual({
      emails: "suggest",
      merges: "tell",
      signatures: "suggest",
      stages: "suggest",
    });
    expect(readAutonomy({ merges: "auto", stages: "maybe" })).toMatchObject({
      merges: "auto",
      stages: "suggest",
    });
  });

  it("never lets plans or automations email or text on their own, whatever was stored", () => {
    for (const stored of ["auto", "tell", "suggest", "nonsense", undefined]) {
      expect(readAutonomy({ emails: stored }).emails).toBe("suggest");
    }
    expect(automationEmailReview()).toBe(true);
    const emails = TRUST_ITEMS.find((t) => t.id === "emails");
    expect(emails?.locked?.level).toBe("suggest");
    expect(emails?.locked?.why).toMatch(/nothing goes out until a person sends it/);
  });
});

describe("When sending is paused", () => {
  const ok = {
    senderOk: true,
    senderAddress: "hello@x.org",
    capReached: false,
    sentLastWeek: 0,
    bouncedLastWeek: 0,
  };

  it("is quiet when everything goes", () => {
    expect(sendingPauses(ok)).toEqual([]);
  });

  it("pauses for the cap first, then an unverified sender", () => {
    const p = sendingPauses({ ...ok, capReached: true, senderOk: false });
    expect(p.map((x) => x.tone)).toEqual(["paused", "paused"]);
    expect(p[0]!.text).toMatch(/spending cap/);
    expect(p[1]!.text).toMatch(/hello@x.org isn't verified/);
  });

  it("warns about bounces only with enough sent", () => {
    expect(sendingPauses({ ...ok, sentLastWeek: 10, bouncedLastWeek: 5 })).toEqual([]);
    const p = sendingPauses({ ...ok, sentLastWeek: 100, bouncedLastWeek: 8 });
    expect(p).toHaveLength(1);
    expect(p[0]!.tone).toBe("warn");
    expect(p[0]!.text).toMatch(/^8% /);
  });
});

describe("Setup: who looks after them", () => {
  const people = [
    { id: "a", relationship: "client" },
    { id: "b", relationship: "client" },
    { id: "c", relationship: "client" },
    { id: "d", relationship: "partner" },
    { id: "e", relationship: null },
    { id: "f", relationship: null, knows: "m2" },
  ];

  it("splits evenly, keeping who already knows them", () => {
    const plan = planOwners("split", people, ["m1", "m2"]);
    const counts = [...plan.assign.values()].reduce(
      (m, o) => m.set(o, (m.get(o) ?? 0) + 1),
      new Map<string | null, number>(),
    );
    expect(counts.get("m1")).toBe(3);
    expect(counts.get("m2")).toBe(3);
    expect(plan.assign.get("f")).toBe("m2");
    expect(plan.routing).toEqual({ mode: "round-robin", pool: ["m1", "m2"], rules: [] });
  });

  it("gives each relationship type to one member, and routes new people the same way", () => {
    const plan = planOwners("rel", people, ["m1", "m2"]);
    expect(new Set(["a", "b", "c"].map((id) => plan.assign.get(id)))).toEqual(new Set(["m1"]));
    expect(plan.assign.get("d")).toBe("m2");
    expect(plan.assign.get("e")).toBe("m2");
    expect(plan.routing.mode).toBe("rules");
    expect(plan.routing.rules).toEqual([
      { field: "relationship", op: "is", value: "client", ownerId: "m1" },
      { field: "relationship", op: "is", value: "partner", ownerId: "m2" },
    ]);
  });

  it("leaves them with nobody, and new people too", () => {
    const plan = planOwners("none", people, ["m1"]);
    expect([...plan.assign.values()].every((o) => o === null)).toBe(true);
    expect(plan.routing.mode).toBe("off");
    expect(planOwners("split", people, []).routing.mode).toBe("off");
  });

  it("starts from what was picked, else a sensible guess for the space", () => {
    expect(startingKinds(false, [], false)).toEqual(["members"]);
    expect(startingKinds(false, [], true)).toEqual(["members", "sponsors"]);
    expect(startingKinds(true, [], false)).toEqual(["clients"]);
    expect(startingKinds(true, ["members", "grants"], false)).toEqual(["grants"]);
  });

  it("sums it up in a line", () => {
    expect(setupSummary(214, "split")).toBe("About 214 people, owners split evenly.");
    expect(setupSummary(1, null)).toBe("About 1 person.");
    expect(setupSummary(1200, "none")).toBe("About 1,200 people, no owners yet.");
  });
});
