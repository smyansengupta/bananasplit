import { describe, expect, it } from "vitest";

import { buildQuestions, OTHER_ANSWERS, parseDefinition } from "./queries/ballots";
import { reportTier } from "./tier";

const definition = {
  questions: [
    {
      key: "theme",
      label: "Theme",
      type: "single",
      options: [
        { key: "climate", label: "Climate" },
        { key: "open", label: "Open track" },
      ],
    },
    { key: "first", label: "First hackathon?", type: "yesno" },
    { key: "notes", label: "Anything else?", type: "text" },
  ],
};

const cell = (question_key: string, choice_key: string, votes: number | null, suppressed = false) => ({
  question_key,
  choice_key,
  votes,
  first_choice: null,
  borda: null,
  ballots: 10,
  suppressed,
});

describe("ballot result shaping", () => {
  it("reads labels and question types, adding Yes/No for yesno", () => {
    const parsed = parseDefinition(definition);
    expect(parsed.map((q) => [q.key, q.type, q.options.map((o) => o.label)])).toEqual([
      ["theme", "single", ["Climate", "Open track"]],
      ["first", "yesno", ["Yes", "No"]],
      ["notes", "text", []],
    ]);
    expect(parseDefinition(null)).toEqual([]);
    expect(parseDefinition({ questions: [{ label: "no key" }, "junk"] })).toEqual([]);
  });

  it("never tallies free text and sorts options by votes", () => {
    const q = buildQuestions(parseDefinition(definition), [cell("theme", "open", 7), cell("theme", "climate", 3)], true);
    expect(q.map((x) => x.key)).toEqual(["theme", "first"]);
    expect(q[0].options.map((o) => [o.label, o.votes])).toEqual([
      ["Open track", 7],
      ["Climate", 3],
    ]);
    // Nobody answered "first": full tiers see zeros.
    expect(q[1].options.map((o) => o.votes)).toEqual([0, 0]);
  });

  it("shows absent options as suppressed for a suppressed tier", () => {
    const q = buildQuestions(parseDefinition(definition), [cell("theme", "open", 7)], false);
    expect(q[0].options.map((o) => [o.key, o.votes, o.suppressed])).toEqual([
      ["open", 7, false],
      ["climate", null, true],
    ]);
  });

  it("folds rare answers outside the definition into one suppressed row", () => {
    const cells = [cell("theme", "open", 7), cell("theme", "my secret idea", null, true), cell("theme", "space", 4)];
    const suppressed = buildQuestions(parseDefinition(definition), cells, false)[0];
    expect(suppressed.options.map((o) => o.key)).toEqual(["open", "space", "climate", OTHER_ANSWERS]);
    expect(JSON.stringify(suppressed)).not.toContain("my secret idea");
    const full = buildQuestions(parseDefinition(definition), [cell("theme", "my secret idea", 1)], true)[0];
    expect(full.options.map((o) => o.key)).toContain("my secret idea");
  });
});

describe("reportTier", () => {
  it("maps TREASURER to MEMBER and refuses non-members", () => {
    expect(reportTier("OWNER")).toBe("OWNER");
    expect(reportTier("ADMIN")).toBe("ADMIN");
    expect(reportTier("TREASURER")).toBe("MEMBER");
    expect(reportTier("MEMBER")).toBe("MEMBER");
    expect(reportTier(null)).toBeNull();
    expect(reportTier("SUPERUSER")).toBeNull();
  });
});
