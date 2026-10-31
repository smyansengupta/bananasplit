import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { answerText, initialsOf, responsesCsv } from "./csv";
import { describeQuestions, questionKind } from "./describe";
import { buttonWord, DEFAULT_DESIGN, readDesign, thanksLine } from "./design";
import {
  blankQuestion,
  QUESTION_CHIPS,
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

describe("design", () => {
  it("defaults anything missing or wrong", () => {
    expect(readDesign(null)).toEqual(DEFAULT_DESIGN);
    expect(readDesign({ accent: "neon" })).toEqual(DEFAULT_DESIGN);
    expect(readDesign({ accent: "plum", cover: "band" })).toMatchObject({
      accent: "plum",
      cover: "band",
    });
  });

  it("says Submit on the last question and the form's own word before", () => {
    expect(buttonWord(DEFAULT_DESIGN, false)).toBe("OK");
    expect(buttonWord({ ...DEFAULT_DESIGN, button: "Next" }, false)).toBe("Next");
    expect(buttonWord({ ...DEFAULT_DESIGN, button: "Next" }, true)).toBe("Submit");
  });

  it("thanks people by first name, or without one", () => {
    expect(thanksLine(DEFAULT_DESIGN, "Jordan")).toBe("Thanks, Jordan.");
    expect(thanksLine(DEFAULT_DESIGN, null)).toBe("Thanks.");
    const own = { ...DEFAULT_DESIGN, thanks: "See you Thursday, {name}!" };
    expect(thanksLine(own, "Jordan")).toBe("See you Thursday, Jordan!");
    expect(thanksLine(own, null)).toBe("See you Thursday!");
  });
});

describe("Forms home and builder lines", () => {
  it("counts questions and names the uploads", () => {
    expect(describeQuestions([q("a", "short"), q("b", "long")])).toBe("2 questions");
    expect(describeQuestions([q("a", "file"), q("b", "image"), q("c", "section")])).toBe(
      "File and photo uploads, 2 questions",
    );
    expect(describeQuestions([q("a", "signature")])).toBe("Signature, 1 question");
  });

  it("describes scales by their range", () => {
    expect(questionKind(q("a", "scale", { min: 1, max: 10 }))).toBe("Scale 1 to 10");
    expect(questionKind(q("a", "choice"))).toBe("Multiple choice");
  });

  it("offers every question type exactly once as a chip", () => {
    expect(QUESTION_CHIPS.map((c) => c.type).sort()).toEqual([...QUESTION_TYPES].sort());
  });
});

describe("responses", () => {
  const team = q("team", "choice", {
    fieldId: "f1",
    options: [
      { id: "o1", label: "Software" },
      { id: "o2", label: "Mechanical" },
    ],
  });
  const why = q("why", "long", { fieldId: "f2" });
  const names = { choices: {}, members: {} };

  it("writes answers in words", () => {
    expect(answerText(team, "o1", names)).toBe("Software");
    expect(answerText(q("y", "yesno"), false, names)).toBe("No");
    expect(answerText(q("r", "rating", { max: 5 }), 4, names)).toBe("4 of 5");
    expect(answerText(team, undefined, names)).toBe("");
  });

  it("exports a CSV that quotes, and never starts a cell with a formula", () => {
    const csv = responsesCsv(
      [team, why],
      [
        {
          who: "Jordan Park",
          email: "j@example.edu",
          status: "NEW",
          createdAt: "2026-10-28T12:00:00.000Z",
          values: { f1: "o1", f2: 'Robots, "big" ones\n=SUM(A1)' },
        },
        {
          who: "=HYPERLINK()",
          email: null,
          status: "ACCEPTED",
          createdAt: "2026-10-29T12:00:00.000Z",
          values: {},
        },
      ],
      names,
      true,
    );
    const [head, first, second] = csv.split("\r\n");
    expect(head).toBe("Response,Email,team,why,Status,Sent");
    expect(first).toContain('"Robots, ""big"" ones');
    expect(first).toContain(",Software,");
    expect(csv).toContain(",New,");
    expect(second!.startsWith("'=HYPERLINK()")).toBe(true);
    expect(second).toContain(",Accepted,");
  });

  it("makes initials", () => {
    expect(initialsOf("Jordan Park")).toBe("JP");
    expect(initialsOf("ava de la cruz")).toBe("AC");
    expect(initialsOf("Sam")).toBe("SA");
    expect(initialsOf("  ")).toBe("?");
  });
});

describe("question polls moved into forms", () => {
  const sql = readFileSync(
    join(process.cwd(), "prisma/migrations/20261101120000_forms_publish_polls/migration.sql"),
    "utf8",
  );

  it("leaves anonymous polls where they are", () => {
    expect(sql).toMatch(/FROM "Poll" WHERE NOT "anonymous" AND "formId" IS NULL/);
  });

  it("writes a question the forms code reads back, and votes it counts", () => {
    // The shape the migration builds: md5's first 10 hex for the question,
    // the poll's own option ids as choices, the column id as fieldId.
    const stored = [
      {
        id: "3f2a9c01be",
        type: "checkboxes",
        title: "Which build nights work?",
        required: true,
        options: [
          { id: "cmpolloptiontue0000000001", label: "Tuesday" },
          { id: "cmpolloptionthu0000000002", label: "Thursday" },
        ],
        allowOther: false,
        fieldId: "pc0123456789abcdef0123456",
      },
    ];
    const read = readQuestions(stored);
    expect(read).toHaveLength(1);
    expect(read[0]).toMatchObject({ type: "checkboxes", fieldId: "pc0123456789abcdef0123456" });

    const field = "pc0123456789abcdef0123456";
    const [s] = summarize(
      read,
      [
        { values: { [field]: ["cmpolloptiontue0000000001"] } },
        { values: { [field]: ["cmpolloptiontue0000000001", "cmpolloptionthu0000000002"] } },
      ],
      () => [],
    );
    expect(s?.kind).toBe("bars");
    if (s?.kind === "bars") expect(s.bars.map((b) => b.count)).toEqual([2, 1]);
  });

  it("publishes moved polls and every form made before drafts", () => {
    expect(sql).toMatch(/UPDATE "Form" SET "publishedAt" = "createdAt"/);
  });
});
