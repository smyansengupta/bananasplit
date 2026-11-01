import { describe, expect, it } from "vitest";

import {
  canCreateTags,
  cleanTagName,
  extractHashTags,
  findTag,
  looseTagKey,
  nearDuplicateGroups,
  tagKey,
} from "./tags";

describe("tag names", () => {
  it("cleans a typed name", () => {
    expect(cleanTagName("  #Fall   showcase ")).toBe("Fall showcase");
    expect(cleanTagName("##")).toBe("");
    expect(cleanTagName("x".repeat(60))).toHaveLength(40);
  });

  it("matches regardless of case", () => {
    const tags = [{ id: "1", name: "Catering" }];
    expect(tagKey("CATERING")).toBe(tagKey("catering"));
    expect(findTag(tags, "#catering")?.id).toBe("1");
    expect(findTag(tags, "cater")).toBeNull();
    expect(findTag(tags, "  ")).toBeNull();
  });

  it("spots near-duplicates", () => {
    expect(looseTagKey("De-signs")).toBe("design");
    expect(looseTagKey("Bus")).toBe("bus");
    const groups = nearDuplicateGroups([
      { name: "Design" },
      { name: "designs" },
      { name: "Food" },
      { name: "de sign" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.map((t) => t.name)).toEqual(["Design", "designs", "de sign"]);
  });
});

describe("extractHashTags", () => {
  it("takes #tags out of a title", () => {
    expect(extractHashTags("Book a photographer #showcase")).toEqual({
      title: "Book a photographer",
      tags: ["showcase"],
    });
    expect(extractHashTags("#venue Confirm the room #Fall-2026 #venue")).toEqual({
      title: "Confirm the room",
      tags: ["venue", "Fall-2026"],
    });
  });

  it("can take out only the tags it could use", () => {
    expect(extractHashTags("Plan #venue and #catering", new Set(["venue"]))).toEqual({
      title: "Plan and #catering",
      tags: ["venue"],
    });
  });

  it("leaves a # inside a word, or on its own, alone", () => {
    expect(extractHashTags("Learn C# and fix issue#4 #")).toEqual({
      title: "Learn C# and fix issue#4 #",
      tags: [],
    });
  });
});

describe("canCreateTags", () => {
  it("follows the organization's switch, which admins always pass", () => {
    expect(canCreateTags({ isAdmin: false, membersCanCreate: true })).toBe(true);
    expect(canCreateTags({ isAdmin: false, membersCanCreate: false })).toBe(false);
    expect(canCreateTags({ isAdmin: true, membersCanCreate: false })).toBe(true);
  });
});
