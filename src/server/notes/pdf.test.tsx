// @vitest-environment node
import { describe, expect, it } from "vitest";

import { notePdfFilename, plainText, renderNotePdf, toWinAnsi, type NotePdfInput } from "./pdf";

const t = (text: string, marks: string[] = []) => ({
  type: "text",
  text,
  marks: marks.map((type) => ({ type })),
});
const p = (...content: object[]) => ({ type: "paragraph", content });
const li = (...content: object[]) => ({ type: "listItem", content });
const cell = (type: string, text: string, colspan = 1) => ({
  type,
  attrs: { colspan },
  content: [p(t(text))],
});

/** One of everything the note editor can produce. */
const everything = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [t("Agenda")] },
    { type: "heading", attrs: { level: 2 }, content: [t("Sub")] },
    { type: "heading", attrs: { level: 3 }, content: [t("Subsub")] },
    p(
      t("bold", ["bold"]),
      t("italic", ["italic"]),
      t("underline", ["underline"]),
      t("strike", ["strike"]),
      t("code", ["code"]),
      { type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://x.org" } }] },
      {
        type: "text",
        text: "js",
        marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
      },
      { type: "hardBreak" },
      t("after break"),
    ),
    p(),
    {
      type: "bulletList",
      content: [li(p(t("a")), { type: "bulletList", content: [li(p(t("b")))] })],
    },
    { type: "orderedList", attrs: { start: 3 }, content: [li(p(t("three")))] },
    {
      type: "taskList",
      content: [
        { type: "taskItem", attrs: { checked: true }, content: [p(t("done"))] },
        { type: "taskItem", attrs: { checked: false }, content: [p(t("todo"))] },
      ],
    },
    { type: "blockquote", content: [p(t("quoted"))] },
    { type: "codeBlock", content: [t("if (x) {\n\treturn  1;\n}")] },
    { type: "horizontalRule" },
    {
      type: "table",
      content: [
        { type: "tableRow", content: [cell("tableHeader", "A"), cell("tableHeader", "B")] },
        { type: "tableRow", content: [cell("tableCell", "spans", 2)] },
      ],
    },
    { type: "someFutureNode", content: [t("kept as text")] },
  ],
};

function input(contentJson: unknown, overrides: Partial<NotePdfInput> = {}): NotePdfInput {
  return {
    title: "Weekly sync",
    contentJson,
    authorName: "Jordan Lee",
    orgName: "Claude Builders Club",
    timezone: "America/New_York",
    updatedAt: new Date("2026-10-01T15:00:00Z"),
    visibility: "ORGANIZATION",
    event: { title: "E-Board sync", startsAt: new Date("2026-10-02T22:00:00Z") },
    ...overrides,
  };
}

function isPdf(buffer: Buffer) {
  return buffer.subarray(0, 5).toString() === "%PDF-";
}

describe("renderNotePdf", () => {
  it("renders every node and mark the editor produces", async () => {
    expect(isPdf(await renderNotePdf(input(everything)))).toBe(true);
  });

  it("renders an empty note, a private note and a note without an event", async () => {
    const empty = { type: "doc", content: [{ type: "paragraph" }] };
    expect(isPdf(await renderNotePdf(input(empty, { visibility: "PRIVATE", event: null })))).toBe(
      true,
    );
  });

  it("survives malformed content instead of failing the download", async () => {
    for (const bad of [
      null,
      "not a doc",
      42,
      { type: "doc", content: "nope" },
      { content: [{}] },
    ]) {
      expect(isPdf(await renderNotePdf(input(bad)))).toBe(true);
    }
  });

  it("flattens pathologically deep nesting to text", async () => {
    let node: object = p(t("bottom"));
    for (let i = 0; i < 2_000; i++) node = { type: "bulletList", content: [li(node)] };
    expect(isPdf(await renderNotePdf(input({ type: "doc", content: [node] })))).toBe(true);
  }, 20_000);
});

describe("plainText", () => {
  it("joins text depth-first and turns hard breaks into newlines", () => {
    expect(plainText(p(t("a"), { type: "hardBreak" }, t("b")))).toBe("a\nb");
    expect(plainText(everything)).toContain("kept as text");
  });
});

describe("toWinAnsi", () => {
  it("keeps Latin-1 and the Windows-1252 punctuation the standard fonts have", () => {
    const text = "café — “quotes” ‘single’ … • €5 ™ Œuvre ñ ü";
    expect(toWinAnsi(text)).toBe(text);
  });

  it("spells common symbols with characters the fonts have", () => {
    expect(toWinAnsi("a → b ⇒ c ← d ≥ 1 ✅ ✔️ done")).toBe("a -> b => c <- d >= 1 [x] [x] done");
  });

  it("replaces each run of undrawable characters with one ?", () => {
    expect(toWinAnsi("party 🎉🎉 time")).toBe("party ? time");
    expect(toWinAnsi("thumbs 👍🏽")).toBe("thumbs ?");
    expect(toWinAnsi("漢字 note")).toBe("? note");
  });

  it("normalizes CRLF", () => {
    expect(toWinAnsi("a\r\nb\rc")).toBe("a\nb\nc");
  });
});

describe("notePdfFilename", () => {
  it("replaces characters a file name can't hold", () => {
    expect(notePdfFilename("Q3 planning / budget")).toBe("Q3 planning - budget.pdf");
    expect(notePdfFilename('a:b*c?"d"<e>|f\\g')).toBe("a-b-c-d-e-f-g.pdf");
  });

  it("falls back for a blank title and caps the length", () => {
    expect(notePdfFilename("   ")).toBe("Untitled note.pdf");
    expect(notePdfFilename("x".repeat(500))).toBe(`${"x".repeat(120)}.pdf`);
  });

  it("keeps non-ASCII names (the header encodes them)", () => {
    expect(notePdfFilename("Réunion  du\tbureau")).toBe("Réunion du bureau.pdf");
  });
});
