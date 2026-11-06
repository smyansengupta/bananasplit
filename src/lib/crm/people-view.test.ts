// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  companyToSave,
  defaultPicks,
  duplicateReason,
  lastTalked,
  mergeWith,
  parseSignature,
  readList,
  relationshipTone,
  rowNext,
  strengthBars,
} from "./people-view";

const NOW = new Date("2026-11-03T15:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("People lists", () => {
  it("reads built-in lists, saved ones and nothing", () => {
    expect(readList(null, false)).toEqual({ kind: "all" });
    expect(readList("cold", false)).toEqual({ kind: "builtin", id: "cold" });
    expect(readList("dupes", false)).toEqual({ kind: "builtin", id: "dupes" });
    expect(readList("clv1abc", false)).toEqual({ kind: "view", id: "clv1abc" });
    expect(readList("<x>", false)).toEqual({ kind: "all" });
  });

  it("has no duplicates list for companies", () => {
    expect(readList("dupes", true)).toEqual({ kind: "all" });
  });
});

describe("a row's next step", () => {
  it("offers Merge first, with who it looks like", () => {
    const r = rowNext(
      { nextFollowUpAt: daysAgo(1), lastContactedAt: null, duplicate: { name: "Samuel Rivera", reason: "Same phone" } },
      NOW,
    );
    expect(r.action).toMatchObject({ kind: "merge", label: "Merge", reason: "Same phone as Samuel Rivera" });
  });

  it("answers someone who wrote before anything else", () => {
    const r = rowNext({ nextFollowUpAt: null, lastContactedAt: daysAgo(200), wroteAt: daysAgo(2) }, NOW);
    expect(r.action).toMatchObject({ kind: "reply", reason: "Wrote 2 days ago" });
  });

  it("follows up when it's due or late", () => {
    expect(rowNext({ nextFollowUpAt: NOW, lastContactedAt: null }, NOW).action).toMatchObject({
      kind: "followup",
      reason: "Due today",
    });
    expect(rowNext({ nextFollowUpAt: daysAgo(3), lastContactedAt: null }, NOW).action?.reason).toBe(
      "3 days late",
    );
  });

  it("checks in on someone going cold, with how long it's been", () => {
    const r = rowNext({ nextFollowUpAt: null, lastContactedAt: daysAgo(94) }, NOW);
    expect(r.action).toMatchObject({ kind: "checkin", tone: "spark", reason: "94 days quiet" });
  });

  it("shows a later next step in words, with no button", () => {
    const r = rowNext({ nextFollowUpAt: new Date("2026-11-06T12:00:00Z"), lastContactedAt: daysAgo(200) }, NOW);
    expect(r).toEqual({ action: null, text: "Follow up, Nov 6" });
  });

  it("offers nothing for someone nobody has talked to yet", () => {
    expect(rowNext({ nextFollowUpAt: null, lastContactedAt: null }, NOW)).toEqual({ action: null, text: "None yet" });
  });

  it("asks for a next step when there's none", () => {
    expect(rowNext({ nextFollowUpAt: null, lastContactedAt: daysAgo(3) }, NOW).action).toMatchObject({
      kind: "add",
      label: "Add a next step",
      reason: "No next step",
    });
  });

  it("offers nothing but a merge to someone who asked not to be contacted", () => {
    expect(rowNext({ nextFollowUpAt: daysAgo(1), lastContactedAt: null, doNotContact: true }, NOW)).toEqual({
      action: null,
      text: "Asked not to be contacted",
    });
  });

  it("words a duplicate's reason", () => {
    expect(duplicateReason("Same email (a@b.org)", "Ann")).toBe("Same email as Ann");
    expect(duplicateReason("Similar names", "Ann")).toBe("Similar name to Ann");
    expect(duplicateReason(null, "Ann")).toBe("Looks like Ann");
  });
});

describe("the table's cells", () => {
  it("says when someone was last talked to", () => {
    expect(lastTalked(null, NOW)).toBe("Never");
    expect(lastTalked(NOW, NOW)).toBe("Today");
    expect(lastTalked(daysAgo(1), NOW)).toBe("Yesterday");
    expect(lastTalked(new Date("2026-10-12T10:00:00Z"), NOW)).toBe("Oct 12");
    expect(lastTalked(new Date("2025-06-14T10:00:00Z"), NOW)).toBe("Jun 2025");
  });

  it("draws strength as up to four bars", () => {
    expect([0, 1, 25, 26, 60, 100].map(strengthBars)).toEqual([0, 1, 1, 2, 3, 4]);
  });

  it("maps relationship colours onto the tag tones", () => {
    expect(relationshipTone("green")).toBe("forest");
    expect(relationshipTone("blue")).toBe("navy");
    expect(relationshipTone("gray")).toBeNull();
    expect(relationshipTone(undefined)).toBeNull();
  });
});

describe("merging two people", () => {
  const a = { name: "Sam Rivera", primaryEmail: "sam@gmail.com", phone: "1", companyId: null, ownerId: "u1" };
  const b = { name: "Samuel Rivera", primaryEmail: "sam@rb.com", phone: "2", companyId: "c1", ownerId: "u2" };

  it("keeps the record whose name you keep, and writes the other side's picks over it", () => {
    expect(
      mergeWith(a, b, { name: "a", primaryEmail: "a", phone: "a", companyId: "b", ownerId: "a" }),
    ).toEqual({ keep: "a", patch: { companyId: "c1" } });
    expect(
      mergeWith(a, b, { name: "b", primaryEmail: "a", phone: "b", companyId: "b", ownerId: "a" }),
    ).toEqual({ keep: "b", patch: { primaryEmail: "sam@gmail.com", ownerId: "u1" } });
  });

  it("starts from the fuller record and fills its gaps from the other", () => {
    expect(defaultPicks(a, b)).toEqual({ name: "b", primaryEmail: "b", phone: "b", companyId: "b", ownerId: "b" });
    expect(defaultPicks({ ...b, companyId: null }, { ...a, companyId: "c9" }).companyId).toBe("b");
  });
});

describe("a pasted signature", () => {
  it("reads name, title, company, email, phone and website", () => {
    const text = `Thanks so much!\n\nOwen Park\nPartnerships Lead\nNorthwind Coffee\nowen@northwindcoffee.com | (617) 555-0123\nnorthwindcoffee.com`;
    expect(parseSignature(text)).toEqual({
      name: "Owen Park",
      title: "Partnerships Lead",
      company: "Northwind Coffee",
      email: "owen@northwindcoffee.com",
      phone: "(617) 555-0123",
      website: "northwindcoffee.com",
    });
  });

  it("splits a title and company on one line", () => {
    const r = parseSignature("Marcus Lee\nProgram Director, Harbor Light Foundation\nmarcus@harborlight.org");
    expect(r).toMatchObject({ name: "Marcus Lee", title: "Program Director", company: "Harbor Light Foundation" });
  });

  it("finds nothing in nothing", () => {
    expect(parseSignature("")).toEqual({
      name: null,
      title: null,
      company: null,
      email: null,
      phone: null,
      website: null,
    });
  });
});

describe("the New card's company", () => {
  it("saves a picked company by id", () => {
    expect(companyToSave({ id: "c1", label: "Acme" }, "Acme")).toEqual({
      companyId: "c1",
      companyName: null,
    });
  });

  it("keeps a typed name nobody clicked Add on", () => {
    expect(companyToSave(null, "  Acme  ")).toEqual({ companyId: null, companyName: "Acme" });
  });

  it("keeps a new one carried over from another kind", () => {
    expect(companyToSave({ id: null, label: "Harborlight" }, "")).toEqual({
      companyId: null,
      companyName: "Harborlight",
    });
  });

  it("saves none when the box is empty", () => {
    expect(companyToSave(null, "   ")).toEqual({ companyId: null, companyName: null });
  });
});
