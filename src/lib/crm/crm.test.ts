import { describe, expect, it } from "vitest";

import {
  companyBlocks,
  findPairs,
  initialMatch,
  nameSimilarity,
  normalizeCompanyName,
  normalizeDomain,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  personBlocks,
  scoreCompanies,
  scorePeople,
  SUGGEST_AT,
  workDomain,
} from "./dedupe";
import { initials, personName, splitName } from "./fields";
import { activityKindOf, detectSource, mapRow, mappingSignature, parseLooseDate, parseVcards, suggestMapping } from "./mapping";
import { planMerge, pickKeeper } from "./merge";
import { resolveCrmTabs } from "./nav";
import { decodeOwner, encodeOwner } from "./record-form";
import { isGoingCold, knowsBest, strengthBand, strengthOf, touchValue } from "./strength";
import { PIPELINE_TEMPLATES, pipelinesFor, relationshipTypesFor, SETUP_KINDS, viewsFor } from "./templates";
import { checkShapes, CrmValidationError, isUrl, missingMessage, missingRequired, normalizeUrl } from "./validate";

const NOW = new Date("2026-11-02T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("dedupe normalizers", () => {
  it("normalizes emails, domains and phones", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
    expect(normalizeEmail("mailto:ada@x.org")).toBe("ada@x.org");
    expect(normalizeEmail("not an email")).toBeNull();
    expect(normalizeDomain("https://www.Example.com/about?x=1")).toBe("example.com");
    expect(normalizeDomain("ada@analytical.org")).toBe("analytical.org");
    expect(normalizeDomain("nope")).toBeNull();
    expect(workDomain("ada@gmail.com")).toBeNull();
    expect(workDomain("ada@analytical.org")).toBe("analytical.org");
    expect(normalizePhone("+1 (617) 555-0101")).toBe("6175550101");
    expect(normalizePhone("617.555.0101")).toBe("6175550101");
    expect(normalizePhone("12")).toBeNull();
  });

  it("folds nicknames, titles, accents and word order in names", () => {
    expect(normalizeName("Dr. Bob  O'Brien Jr.")).toBe("robert obrien");
    expect(normalizeName("José Núñez")).toBe("jose nunez");
    expect(nameSimilarity("Lovelace Ada", "Ada Lovelace")).toBe(1);
    expect(nameSimilarity("Bill Gates", "William Gates")).toBe(1);
    expect(nameSimilarity("Ada Lovelace", "Grace Hopper")).toBeLessThan(0.7);
    expect(initialMatch("A. Lovelace", "Ada Lovelace")).toBe(true);
    expect(initialMatch("B. Lovelace", "Ada Lovelace")).toBe(false);
    expect(normalizeCompanyName("The Harbor Light Coffee Co., Inc.")).toBe("harbor light coffee");
  });
});

describe("dedupe scoring", () => {
  const ada = { id: "a", name: "Ada Lovelace", emails: ["ada@analytical.org"], phone: "617-555-0101", companyId: "c1" };

  it("is certain on a shared address", () => {
    const s = scorePeople(ada, { id: "b", name: "Countess of Lovelace", emails: ["ADA@analytical.org"] });
    expect(s.score).toBe(100);
    expect(s.reasons[0]).toMatch(/Same email/);
  });

  it("adds up name, phone and company", () => {
    const s = scorePeople(ada, { id: "b", name: "Ada Lovelace", emails: ["countess@gmail.com"], phone: "+1 617 555 0101" });
    expect(s.score).toBeGreaterThanOrEqual(90);
    expect(s.reasons).toEqual(expect.arrayContaining(["Same name", "Same phone"]));
  });

  it("doesn't call colleagues duplicates for sharing a domain", () => {
    const s = scorePeople(ada, { id: "b", name: "Charles Babbage", emails: ["charles@analytical.org"], companyId: "c1" });
    expect(s.score).toBeLessThan(SUGGEST_AT);
  });

  it("suggests the same name with an initial at the same company", () => {
    const s = scorePeople(ada, { id: "b", name: "A. Lovelace", emails: [], companyId: "c1" });
    expect(s.score).toBeGreaterThan(0);
  });

  it("scores companies on domain, then name", () => {
    expect(scoreCompanies({ id: "1", name: "Harbor", domain: "harbor.coffee" }, { id: "2", name: "HL", website: "https://www.harbor.coffee" }).score).toBe(100);
    expect(scoreCompanies({ id: "1", name: "Harbor Light Coffee Co." }, { id: "2", name: "harbor light coffee" }).score).toBe(90);
    expect(scoreCompanies({ id: "1", name: "Harbor Light" }, { id: "2", name: "Northbank Credit" }).score).toBe(0);
  });

  it("finds each likely pair once, through blocking", () => {
    const people = [
      ada,
      { id: "b", name: "Ada Lovelace", emails: ["ada@analytical.org"] },
      { id: "c", name: "Grace Hopper", emails: ["grace@navy.mil"] },
      { id: "d", name: "Grace Hopper", emails: [], phone: "212 555 0199" },
      { id: "e", name: "Alan Turing", emails: ["alan@bletchley.uk"] },
    ];
    const pairs = findPairs(people, personBlocks, scorePeople);
    const keys = pairs.map((p) => [p.a.id, p.b.id].sort().join("|"));
    expect(keys).toContain("a|b");
    expect(keys).not.toContain("a|e");
    expect(new Set(keys).size).toBe(keys.length);
    expect(pairs[0]!.score).toBe(100);
    expect(companyBlocks({ id: "x", name: "Harbor Light", domain: "harbor.coffee" })).toEqual(["d:harbor.coffee", "n:harbo"]);
  });
});

describe("merge plan", () => {
  it("keeps the kept record's values, fills blanks, and lists conflicts", () => {
    const plan = planMerge(
      {
        fields: { title: "Lead", phone: null, lastContactedAt: daysAgo(10), nextFollowUpAt: daysAgo(-5), strength: 20, doNotContact: false },
        custom: { size: "M", tags: ["a"] },
      },
      {
        fields: { title: "Intern", phone: "555", lastContactedAt: daysAgo(2), nextFollowUpAt: daysAgo(-1), strength: 50, doNotContact: true },
        custom: { size: "L", tags: ["b", "a"], diet: "vegan" },
      },
    );
    expect(plan.set.phone).toBe("555");
    expect(plan.set.title).toBeUndefined();
    expect(plan.set.lastContactedAt).toEqual(daysAgo(2));
    expect(plan.set.nextFollowUpAt).toEqual(daysAgo(-1));
    expect(plan.set.strength).toBe(50);
    expect(plan.set.doNotContact).toBe(true);
    expect(plan.custom).toEqual({ size: "M", tags: ["a", "b"], diet: "vegan" });
    expect(plan.conflicts.map((c) => c.key).sort()).toEqual(["custom.size", "title"]);
  });

  it("keeps the fuller record, then the older one", () => {
    const a = { id: "a", createdAt: daysAgo(10), fields: { x: 1, y: null } as Record<string, unknown> };
    const b = { id: "b", createdAt: daysAgo(20), fields: { x: 1, y: 2 } as Record<string, unknown> };
    expect(pickKeeper(a, b)[0].id).toBe("b");
    expect(pickKeeper({ ...a, fields: { x: 1, y: 2 } }, b)[0].id).toBe("b");
  });
});

describe("import mapping", () => {
  it("knows where a file came from", () => {
    expect(detectSource(["First Name", "Last Name", "Email", "Contact owner", "Lifecycle Stage"])).toBe("hubspot");
    expect(detectSource(["Person - Name", "Person - Email", "Organization - Name"])).toBe("pipedrive");
    expect(detectSource(["First Name", "Last Name", "Account Name", "Mailing City"])).toBe("salesforce");
    expect(detectSource(["Name", "Tags", "Created time", "Last edited time"])).toBe("notion");
    expect(detectSource(["Name", "Email"], "contacts.vcf")).toBe("vcard");
    expect(detectSource(["Name", "Email"])).toBe("csv");
  });

  it("maps HubSpot columns, notes to the timeline", () => {
    const m = suggestMapping("person", ["First Name", "Last Name", "Email", "Company Name", "Job Title", "Phone Number", "Contact owner", "Notes", "Create Date", "Favorite color"]);
    expect(m).toMatchObject({
      "First Name": "firstName",
      "Last Name": "lastName",
      Email: "primaryEmail",
      "Company Name": "company",
      "Job Title": "title",
      "Phone Number": "phone",
      "Contact owner": "owner",
      Notes: "activity.body",
      "Create Date": "activity.date",
      "Favorite color": null,
    });
  });

  it("maps Pipedrive deals, custom fields by name, and remembers choices", () => {
    const m = suggestMapping("deal", ["Deal - Title", "Deal - Value", "Deal - Stage", "Organization - Name", "Budget code"], [{ id: "f1", name: "Budget code" }], {
      "Deal - Stage": null,
    });
    expect(m["Deal - Title"]).toBe("title");
    expect(m["Deal - Value"]).toBe("amount");
    expect(m["Deal - Stage"]).toBeNull();
    expect(m["Organization - Name"]).toBe("company");
    expect(m["Budget code"]).toBe("custom:f1");
  });

  it("turns a row into fields, custom values and an activity", () => {
    const row = mapRow(
      { Name: " Ada ", Email: "ada@x.org", Size: "L", Notes: "Met at the fair", When: "3/14/2026", Blank: "" },
      { Name: "name", Email: "primaryEmail", Size: "custom:f1", Notes: "activity.body", When: "activity.date", Blank: "title" },
    );
    expect(row.fields).toEqual({ name: "Ada", primaryEmail: "ada@x.org" });
    expect(row.custom).toEqual({ f1: "L" });
    expect(row.activity).toEqual({ body: "Met at the fair", date: "3/14/2026", subject: undefined, kind: undefined });
    expect(mapRow({ A: "x" }, { A: null }).activity).toBeNull();
  });

  it("signs a set of columns whatever their order or case", () => {
    expect(mappingSignature("person", ["Email", "Name"])).toBe(mappingSignature("person", ["name", "EMAIL"]));
    expect(mappingSignature("person", ["Email"])).not.toBe(mappingSignature("company", ["Email"]));
  });

  it("reads dates and activity types as tools write them", () => {
    expect(parseLooseDate("2026-03-14")?.toISOString().slice(0, 10)).toBe("2026-03-14");
    expect(parseLooseDate("3/14/2026 2:30 PM")?.getUTCHours()).toBe(14);
    expect(parseLooseDate("garbage")).toBeNull();
    expect(activityKindOf("Logged call")).toBe("CALL");
    expect(activityKindOf("EMAIL")).toBe("EMAIL");
    expect(activityKindOf("Lunch")).toBe("MEETING");
    expect(activityKindOf(undefined)).toBe("NOTE");
  });

  it("reads vCards, folded lines and all", () => {
    const vcf = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Ada Lovelace",
      "N:Lovelace;Ada;;;",
      "EMAIL;TYPE=WORK:ada@analytical.org",
      "EMAIL;TYPE=HOME:ada@home.org",
      "TEL;TYPE=CELL:+1 617 555 0101",
      "ORG:Analytical Engines;Research",
      "TITLE:Programmer",
      "NOTE:Wrote the first",
      "  program",
      "END:VCARD",
      "BEGIN:VCARD",
      "FN:Charles Babbage",
      "END:VCARD",
    ].join("\r\n");
    const { headers, rows } = parseVcards(vcf);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      Name: "Ada Lovelace",
      "First name": "Ada",
      "Last name": "Lovelace",
      Email: "ada@analytical.org",
      "Other emails": "ada@home.org",
      Phone: "+1 617 555 0101",
      Company: "Analytical Engines",
      Title: "Programmer",
      Notes: "Wrote the first program",
    });
    expect(headers).toContain("Other emails");
    expect(suggestMapping("person", headers).Notes).toBe("activity.body");
  });
});

describe("validation", () => {
  it("checks shapes and names the fields", () => {
    expect(() => checkShapes("person", { name: "Ada", primaryEmail: "ada@x.org", website: "x.org" })).not.toThrow();
    expect(() => checkShapes("person", { name: "" })).toThrow(CrmValidationError);
    try {
      checkShapes("deal", { title: "A", amountCents: -5 });
    } catch (e) {
      expect((e as CrmValidationError).fields).toEqual(["amount"]);
    }
    expect(() => checkShapes("company", { domain: "not a domain" })).toThrow(/domain/);
    expect(() => checkShapes("person", { keepInTouchDays: 0 })).toThrow();
    expect(isUrl("example.com/about")).toBe(true);
    expect(isUrl("javascript:alert(1)")).toBe(false);
    expect(normalizeUrl("example.com")).toBe("https://example.com");
  });

  it("finds what a stage needs and says it plainly", () => {
    expect(missingRequired(["closeReason", "amount", "f1"], { closeReason: "  ", amount: 0, f1: [] })).toEqual(["closeReason", "f1"]);
    expect(missingMessage(["Reason"], "Lost")).toBe("Add Reason to move it to Lost.");
    expect(missingMessage(["Reason", "Amount", "Date"])).toBe("Add Reason, Amount and Date first.");
  });
});

describe("relationship strength", () => {
  it("weighs touchpoints and halves them every 90 days", () => {
    expect(touchValue({ kind: "MEETING", at: NOW }, NOW)).toBe(10);
    expect(touchValue({ kind: "MEETING", at: daysAgo(90) }, NOW)).toBeCloseTo(5);
    expect(touchValue({ kind: "FIELD_CHANGE", at: NOW }, NOW)).toBe(0);
    expect(strengthOf([], NOW)).toBe(0);
    const recent = Array.from({ length: 4 }, (_, i) => ({ kind: "MEETING", at: daysAgo(i * 7) }));
    const old = Array.from({ length: 4 }, (_, i) => ({ kind: "MEETING", at: daysAgo(400 + i * 7) }));
    expect(strengthOf(recent, NOW)).toBeGreaterThan(strengthOf(old, NOW));
    expect(strengthOf(Array.from({ length: 50 }, () => ({ kind: "MEETING", at: NOW })), NOW)).toBeLessThanOrEqual(100);
    expect(strengthBand(0)).toBe("none");
    expect(strengthBand(80)).toBe("strong");
  });

  it("knows who knows them best, and who is going cold", () => {
    const touches = [
      { kind: "MEETING", at: NOW, actorId: "u1" },
      { kind: "EMAIL", at: NOW, actorId: "u2" },
      { kind: "MEETING", at: daysAgo(3), actorId: "u1" },
      { kind: "CHECK_IN", at: NOW, actorId: null },
    ];
    expect(knowsBest(touches, NOW).map((k) => k.userId)).toEqual(["u1", "u2"]);
    expect(isGoingCold({ lastContactedAt: daysAgo(61), keepInTouchDays: null }, NOW)).toBe(true);
    expect(isGoingCold({ lastContactedAt: daysAgo(20), keepInTouchDays: 14 }, NOW)).toBe(true);
    expect(isGoingCold({ lastContactedAt: daysAgo(20), keepInTouchDays: 30 }, NOW)).toBe(false);
    expect(isGoingCold({ lastContactedAt: null, keepInTouchDays: 7 }, NOW)).toBe(false);
  });
});

describe("setup templates", () => {
  it("makes a pipeline per answer, in setup order, and alumni get a cadence instead", () => {
    expect(pipelinesFor(["sponsors", "members", "alumni"]).map((p) => p.template)).toEqual(["members", "sponsors"]);
    expect(PIPELINE_TEMPLATES.members!.wonLabel).toBe("Joined");
    expect(PIPELINE_TEMPLATES.members!.lostLabel).toBe("Didn't join");
  });

  it("gives Sponsorships Finance's own stage keys", () => {
    expect(PIPELINE_TEMPLATES.sponsors!.stages.map((s) => s.key)).toEqual([
      "PROSPECT",
      "COMMITTED",
      "INVOICED",
      "RECEIVED",
      "DECLINED",
      "WRITTEN_OFF",
    ]);
  });

  it("asks for a reason on every lost stage, and has an open stage first", () => {
    for (const k of SETUP_KINDS) {
      const t = PIPELINE_TEMPLATES[k];
      if (!t) continue;
      expect(t.stages[0]!.kind).toBe("OPEN");
      for (const s of t.stages.filter((x) => x.kind === "LOST")) expect(s.requiredFields).toContain("closeReason");
      expect(new Set(t.stages.map((s) => s.key)).size).toBe(t.stages.length);
    }
  });

  it("collects relationship types and views once each", () => {
    const types = relationshipTypesFor(["donors", "sponsors", "donors"]);
    expect(types.map((t) => t.id)).toEqual(["member", "donor", "sponsor", "partner"]);
    expect(viewsFor(["alumni"]).some((v) => v.name === "Alumni")).toBe(true);
    expect(viewsFor([]).some((v) => v.name === "Alumni")).toBe(false);
  });
});

describe("small helpers", () => {
  it("names people from their parts or their address", () => {
    expect(personName({ firstName: "Ada", lastName: "Lovelace" })).toBe("Ada Lovelace");
    expect(personName({ email: "grace.hopper@navy.mil" })).toBe("Grace Hopper");
    expect(splitName("Ada King Lovelace")).toEqual({ firstName: "Ada King", lastName: "Lovelace" });
    expect(initials("Ada Lovelace")).toBe("AL");
  });

  it("encodes owners as a member or a role", () => {
    expect(encodeOwner("u1", null)).toBe("u:u1");
    expect(encodeOwner("u1", "sponsorship-lead")).toBe("r:sponsorship-lead");
    expect(decodeOwner("r:lead")).toEqual({ ownerId: null, ownerRoleKey: "lead" });
    expect(decodeOwner("")).toEqual({ ownerId: null, ownerRoleKey: null });
  });

  it("puts each pipeline in the tab list where pipelines go, settings for managers only", () => {
    const tabs = resolveCrmTabs("o", [{ id: "p1", name: "Donations" }], { manager: false, counts: { review: 3 } });
    expect(tabs.map((t) => t.label)).toEqual(["Today", "People", "Companies", "Donations", "Forecast", "Duplicates"]);
    expect(tabs.find((t) => t.id === "review")?.count).toBe(3);
    expect(resolveCrmTabs("o", [], { manager: true }).map((t) => t.id)).toEqual(expect.arrayContaining(["settings", "automations"]));
  });
});
