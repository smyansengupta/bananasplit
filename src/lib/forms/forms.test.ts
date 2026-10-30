import { describe, expect, it } from "vitest";

import { checkSubmission, OTHER } from "./answers";
import {
  blankQuestion,
  FORM_TEMPLATES,
  firstQuestionId,
  nextQuestionId,
  pathThrough,
  QUESTION_META,
  QUESTION_TYPES,
  readQuestions,
  type Question,
} from "./questions";
import { summarize } from "./summary";

const q = (id: string, type: Question["type"], extra: Partial<Question> = {}): Question => ({
  ...blankQuestion(type, id),
  id,
  ...extra,
});

describe("questions", () => {
  it("gives every type a label, and a column type unless it's a section break", () => {
    for (const t of QUESTION_TYPES) {
      expect(QUESTION_META[t].label.length).toBeGreaterThan(0);
      expect(QUESTION_META[t].field === null).toBe(t === "section");
    }
  });

  it("reads stored questions safely and drops anything that doesn't fit", () => {
    expect(readQuestions(null)).toEqual([]);
    expect(readQuestions([{ id: "a", type: "nope", title: "x" }])).toEqual([]);
    const ok = readQuestions([{ id: "a", type: "short", title: "Name" }]);
    expect(ok).toEqual([{ id: "a", type: "short", title: "Name", required: false }]);
  });

  it("builds every template into valid questions", () => {
    for (const t of FORM_TEMPLATES) {
      const qs = t.questions();
      expect(readQuestions(qs)).toHaveLength(qs.length);
    }
  });

  it("starts choices with two options, scales 1 to 10, ratings out of 5", () => {
    expect(blankQuestion("choice").options).toHaveLength(2);
    expect(blankQuestion("scale")).toMatchObject({ min: 1, max: 10 });
    expect(blankQuestion("rating").max).toBe(5);
  });
});

describe("skip logic", () => {
  const team = q("team", "choice", {
    options: [
      { id: "eng", label: "Engineering" },
      { id: "out", label: "Outreach" },
    ],
    logic: [{ when: "out", goTo: "hours" }],
  });
  const questions = [
    q("name", "short"),
    team,
    q("code", "long"),
    q("hours", "scale"),
    q("src", "hidden"),
  ];

  it("goes in order unless a rule matches, and skips hidden fields", () => {
    expect(firstQuestionId(questions)).toBe("name");
    expect(nextQuestionId(questions, "team", "eng")).toBe("code");
    expect(nextQuestionId(questions, "team", "out")).toBe("hours");
    expect(nextQuestionId(questions, "hours", 5)).toBeNull();
  });

  it("never jumps backwards, so a form can't loop", () => {
    const back = [q("a", "choice", { logic: [{ when: "x", goTo: "a" }] }), q("b", "short")];
    expect(nextQuestionId(back, "a", "x")).toBe("b");
  });

  it("ends the form on a rule that says so", () => {
    const end = [q("a", "yesno", { logic: [{ when: "no", goTo: "end" }] }), q("b", "short")];
    expect(nextQuestionId(end, "a", false)).toBeNull();
    expect(nextQuestionId(end, "a", true)).toBe("b");
  });

  it("only requires the questions on the path taken", () => {
    const required = questions.map((x) => ({ ...x, required: x.type !== "hidden" }));
    const path = pathThrough(required, { name: "Ada", team: "out", hours: 4 });
    expect(path.map((x) => x.id)).toEqual(["name", "team", "hours"]);
    const { errors } = checkSubmission(required, {
      answers: { name: "Ada", team: "out", hours: 4 },
      other: {},
    });
    expect(errors).toEqual({});
  });
});

describe("answer checks", () => {
  const choice = q("c", "choice", {
    required: true,
    allowOther: true,
    options: [{ id: "a", label: "A" }],
  });
  const check = (question: Question, value: unknown, other = "") =>
    checkSubmission([question], {
      answers: { [question.id]: value as never },
      other: other ? { [question.id]: other } : {},
    }).errors[question.id] ?? null;

  it("holds required questions to an answer", () => {
    expect(check(choice, null)).toMatch(/Pick one/);
    expect(check(q("s", "short", { required: true }), "  ")).toMatch(/fill this in/);
  });

  it("accepts Other only with text, and only when it's allowed", () => {
    expect(check(choice, OTHER, "Pizza")).toBeNull();
    expect(check(choice, OTHER)).toMatch(/Pick one/);
    expect(check({ ...choice, allowOther: false }, OTHER, "x")).toMatch(/Pick one/);
  });

  it("checks each type's shape", () => {
    expect(check(q("e", "email"), "nope")).toMatch(/email/);
    expect(check(q("e", "email"), "a@b.edu")).toBeNull();
    expect(check(q("r", "rating"), 6)).toMatch(/1 to 5/);
    expect(check(q("sc", "scale", { min: 0, max: 10 }), 0)).toBeNull();
    expect(check(q("d", "date"), "2026-11-05")).toBeNull();
    const rank = q("k", "ranking", {
      options: [
        { id: "x", label: "X" },
        { id: "y", label: "Y" },
      ],
    });
    expect(check(rank, ["y", "x"])).toBeNull();
    expect(check(rank, ["y"])).toMatch(/every choice/);
  });
});

describe("summary", () => {
  it("counts choices, averages scales and keeps the latest text", () => {
    const team = q("team", "checkboxes", {
      fieldId: "f1",
      options: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
    });
    const hours = q("hours", "scale", { fieldId: "f2", min: 1, max: 3 });
    const why = q("why", "long", { fieldId: "f3" });
    const out = summarize(
      [team, hours, why],
      [
        { values: { f1: ["a", "b"], f2: 3, f3: "first" } },
        { values: { f1: ["a", "extra"], f2: 1, f3: "second" } },
      ],
      (id) => (id === "f1" ? [{ id: "extra", label: "Pizza" }] : []),
    );
    expect(out[0]).toMatchObject({
      kind: "bars",
      bars: [
        { id: "a", count: 2 },
        { id: "b", count: 1 },
        { id: "extra", label: "Pizza", count: 1 },
      ],
    });
    expect(out[1]).toMatchObject({ kind: "scale", average: 2 });
    expect(out[2]).toMatchObject({ kind: "text", samples: ["second", "first"] });
  });
});
