// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  classifyBallot,
  definitionLabels,
  fromWebsitePoll,
  isTestSlug,
  parseDefinitionImport,
  readDefinition,
} from "./ballot-definitions";

const websitePoll = {
  slug: "info-session-2026-09",
  title: "Info Session Poll",
  opensAt: "2026-08-18T00:00:00-04:00",
  closesAt: "2026-09-17T22:00:00-04:00",
  sections: [
    {
      key: "ballot",
      questions: [
        {
          key: "workshops",
          type: "slots",
          prompt: "Pick three workshops in the order you want them",
          slots: [{ label: "Slot 2" }, { label: "Slot 3" }],
          pool: [
            { key: "tools", label: "Building tools with Claude" },
            { key: "agents", label: "Student agents" },
            { key: "school", label: "Claude for school" },
          ],
        },
      ],
    },
    {
      key: "hackathon",
      questions: [
        {
          key: "theme",
          type: "single",
          prompt: "Which theme?",
          options: [
            { key: "money-moves", label: "Money Moves" },
            { key: "fix-northeastern", label: "Fix Northeastern" },
          ],
        },
        { key: "notes", type: "text", prompt: "Anything else?" },
        { key: "mystery", type: "carousel", prompt: "Unknown type" },
      ],
    },
  ],
};

describe("importing the website's poll file", () => {
  const imported = fromWebsitePoll(websitePoll);

  it("uses the website's flat section.question answer keys", () => {
    expect(imported.definition.questions.map((q) => q.key)).toEqual([
      "ballot.workshops",
      "hackathon.theme",
      "hackathon.notes",
    ]);
  });

  it("takes the pool as the options of a ranked question", () => {
    const workshops = imported.definition.questions[0];
    expect(workshops.type).toBe("slots");
    expect(workshops.options.map((o) => o.key)).toEqual(["tools", "agents", "school"]);
  });

  it("skips question types the ballot does not render", () => {
    expect(imported.definition.questions.some((q) => q.key === "hackathon.mystery")).toBe(false);
  });

  it("keeps the window as instants", () => {
    expect(imported.opensAt?.toISOString()).toBe("2026-08-18T04:00:00.000Z");
    expect(imported.closesAt?.toISOString()).toBe("2026-09-18T02:00:00.000Z");
  });

  it("also accepts the suite's own shape, and refuses anything else", () => {
    const own = parseDefinitionImport({
      slug: "board-2027",
      title: "Board election",
      questions: [
        {
          key: "president",
          label: "President",
          type: "single",
          options: [{ key: "a", label: "A" }],
        },
      ],
    });
    expect(own.definition.questions[0].key).toBe("president");
    expect(() => parseDefinitionImport({ nope: true })).toThrow(/poll file/i);
    expect(() => parseDefinitionImport({ slug: "Bad Slug!", title: "x", questions: [] })).toThrow();
  });

  it("labels questions and options, falling back to the raw key", () => {
    const labels = definitionLabels(imported.definition);
    expect(labels.question("ballot.workshops")).toBe(
      "Pick three workshops in the order you want them",
    );
    expect(labels.choice("ballot.workshops", "tools")).toBe("Building tools with Claude");
    expect(labels.choice("ballot.workshops", "retired")).toBe("retired");
    expect(labels.question("gone.away")).toBe("gone.away");
  });

  it("readDefinition tolerates a malformed stored value", () => {
    expect(readDefinition(null).questions).toEqual([]);
    expect(readDefinition({ questions: "nope" }).questions).toEqual([]);
  });
});

describe("which ballots count", () => {
  const def = {
    isTest: false,
    opensAt: new Date("2026-08-18T04:00:00Z"),
    closesAt: new Date("2026-09-18T02:00:00Z"),
    definition: fromWebsitePoll(websitePoll).definition,
  };
  const good = {
    pollSlug: "info-session-2026-09",
    castAt: new Date("2026-09-17T22:00:00Z"),
    answers: {
      "ballot.workshops": ["tools", "agents"],
      "hackathon.theme": "money-moves",
      "hackathon.notes": "more pizza",
    },
  };

  it("counts a ballot inside the window with current options", () => {
    expect(classifyBallot(good, def)).toBeNull();
  });

  it.each(["loadtest-1", "loadtest", "smoke-test-3", "smoke", "SMOKE-TEST-9"])(
    "never imports the test slug %s",
    (slug) => {
      expect(isTestSlug(slug)).toBe(true);
      expect(classifyBallot({ ...good, pollSlug: slug }, def)).toBe("test-slug");
    },
  );

  it("does not treat a real slug as a test slug", () => {
    expect(isTestSlug("info-session-2026-09")).toBe(false);
    expect(isTestSlug("smokey-mountains-poll")).toBe(false);
  });

  it("excludes a ballot with no definition, and a test poll", () => {
    expect(classifyBallot(good, null)).toBe("no-definition");
    expect(classifyBallot(good, { ...def, isTest: true })).toBe("test-poll");
  });

  it("excludes ballots outside the window, rounding the opening hour down", () => {
    expect(classifyBallot({ ...good, castAt: new Date("2026-08-17T23:00:00Z") }, def)).toBe(
      "before-window",
    );
    // The website rounds castAt down to the hour, so the opening hour counts.
    expect(classifyBallot({ ...good, castAt: new Date("2026-08-18T04:00:00Z") }, def)).toBeNull();
    expect(classifyBallot({ ...good, castAt: new Date("2026-09-18T02:00:00Z") }, def)).toBe(
      "after-window",
    );
  });

  it("excludes pre-launch ballots that name retired options or questions", () => {
    expect(classifyBallot({ ...good, answers: { "ballot.workshops": ["claude-code"] } }, def)).toBe(
      "retired-option",
    );
    expect(classifyBallot({ ...good, answers: { "ballot.prompting": "yes" } }, def)).toBe(
      "retired-option",
    );
  });

  it("accepts free text and yes/no shapes", () => {
    const yesno = {
      ...def,
      definition: {
        questions: [{ key: "first", label: "First?", type: "yesno" as const, options: [] }],
      },
    };
    expect(classifyBallot({ ...good, answers: { first: true } }, yesno)).toBeNull();
    expect(classifyBallot({ ...good, answers: { first: "perhaps" } }, yesno)).toBe(
      "retired-option",
    );
  });
});
