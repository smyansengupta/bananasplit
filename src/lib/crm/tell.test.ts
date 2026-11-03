// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { AskPlan } from "@/lib/crm/ai-outputs";

import { peopleQueryOf } from "./ask-intent";
import { matchMember, matchStage, standinChange } from "./tell";

const members = [
  { id: "u1", name: "Jackson Lam" },
  { id: "u2", name: "Kristine Reyes" },
  { id: "u3", name: "Kristine Ober" },
  { id: "u4", name: "Marcus Hill" },
];

describe("telling the CRM a change", () => {
  it("reads move and give without AI", () => {
    expect(
      standinChange("Move Harbor Light renewal to Committed and give it to Marcus"),
    ).toMatchObject({
      record: "Harbor Light renewal",
      kind: "item",
      stage: "Committed",
      owner: "Marcus",
    });
    expect(standinChange("Assign Rosa Diaz to Jackson Lam")).toMatchObject({
      record: "Rosa Diaz",
      owner: "Jackson Lam",
      stage: null,
    });
  });

  it("finds the member by full name, else a first name only one has", () => {
    expect(matchMember("jackson lam", members)?.id).toBe("u1");
    expect(matchMember("Marcus", members)?.id).toBe("u4");
    expect(matchMember("Kristine", members)).toBeNull();
    expect(matchMember("Kristine Ober", members)?.id).toBe("u3");
    expect(matchMember("", members)).toBeNull();
  });

  it("finds the stage exactly, else the one that contains it", () => {
    const stages = [{ name: "Talking" }, { name: "Committed" }, { name: "Won" }];
    expect(matchStage("committed", stages)?.name).toBe("Committed");
    expect(matchStage("commit", stages)?.name).toBe("Committed");
    expect(matchStage("Lost", stages)).toBeNull();
  });
});

describe("an answer's people as a People list", () => {
  const plan = (p: Partial<AskPlan>): AskPlan => ({
    query: "find_people",
    search: null,
    name: null,
    kind: null,
    pipeline: null,
    stage: null,
    relationship: null,
    days: null,
    since: null,
    onlyMine: false,
    openOnly: false,
    ...p,
  });
  const types = [{ id: "donor", label: "Donor" }];

  it("maps the queries People can show", () => {
    expect(peopleQueryOf(plan({ query: "going_cold", kind: "person", days: 60 }), types)).toEqual({
      due: "cold",
    });
    expect(peopleQueryOf(plan({ query: "going_cold", days: 60, onlyMine: true }), types)).toEqual({
      due: "cold",
      owner: "me",
    });
    expect(peopleQueryOf(plan({ relationship: "donors" }), types)).toBeNull();
    expect(peopleQueryOf(plan({ relationship: "donor" }), types)).toEqual({ rel: "donor" });
    expect(peopleQueryOf(plan({ search: "bakery" }), types)).toEqual({ q: "bakery" });
  });

  it("leaves out what People can't show", () => {
    expect(peopleQueryOf(plan({ query: "going_cold", days: 30 }), types)).toBeNull();
    expect(
      peopleQueryOf(plan({ query: "going_cold", kind: "company", days: 60 }), types),
    ).toBeNull();
    expect(peopleQueryOf(plan({ days: 90 }), types)).toBeNull();
    expect(peopleQueryOf(plan({ query: "counts" }), types)).toBeNull();
  });
});
