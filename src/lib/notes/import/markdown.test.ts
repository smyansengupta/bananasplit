// @vitest-environment node
import { describe, expect, it } from "vitest";

import { checkNoteContent } from "@/lib/collab/note-doc";

import { noteToMarkdown } from "../export/markdown";
import { markdownToNote } from "./markdown";

const p = (...content: object[]) => ({ type: "paragraph", content });
const t = (text: string, marks?: (string | { type: string; attrs: object })[]) => ({
  type: "text",
  text,
  ...(marks ? { marks: marks.map((m) => (typeof m === "string" ? { type: m } : m)) } : {}),
});
const link = (href: string) => ({ type: "link", attrs: { href } });
const li = (...content: object[]) => ({ type: "listItem", content });
const cell = (type: "tableHeader" | "tableCell", ...content: object[]) => ({
  type,
  content: [p(...content)],
});

/** A document as the note schema stores it (defaults filled in, marks in order). */
const stored = (doc: object) => checkNoteContent(doc).json;

/**
 * Every block the converter writes, as the editor would save it. Marks
 * start and end on words: the export keeps spaces outside the markers, so
 * " sharp" in italics comes back as a space, then "sharp" in italics.
 */
const DOC = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [t("Timeline")] },
    p(
      t("Doors at "),
      t("6:30", ["bold"]),
      t(" "),
      t("sharp", ["italic"]),
      t(", "),
      t("not 7", ["strike"]),
      t(", "),
      t("really", ["underline"]),
      t(" and "),
      t("npm run dev", ["code"]),
    ),
    p(t("Tickets on "), t("the site", [link("https://example.com/tickets")]), t(".")),
    p(t("Line one"), { type: "hardBreak" }, t("line two")),
    p(t("Specials: a_b *c* [d] #e <f> |g| ~h~ \\i")),
    {
      type: "bulletList",
      content: [
        li(p(t("Badges"))),
        li(p(t("Lanyards")), { type: "bulletList", content: [li(p(t("Blue")))] }),
      ],
    },
    {
      type: "orderedList",
      attrs: { start: 3 },
      content: [li(p(t("Third"))), li(p(t("Fourth")))],
    },
    {
      type: "taskList",
      content: [
        { type: "taskItem", attrs: { checked: true }, content: [p(t("Book the room"))] },
        { type: "taskItem", attrs: { checked: false }, content: [p(t("Order pizza"))] },
      ],
    },
    { type: "blockquote", content: [p(t("Be there early."))] },
    {
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [{ type: "text", text: "const a = 1;\nconst b = 2;" }],
    },
    { type: "horizontalRule" },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [cell("tableHeader", t("Item")), cell("tableHeader", t("Cost"))],
        },
        {
          type: "tableRow",
          content: [cell("tableCell", t("Pizza")), cell("tableCell", t("$40", ["bold"]))],
        },
      ],
    },
    p(t("The end.")),
  ],
};

describe("markdownToNote", () => {
  it("reads Download Markdown back as the same note", () => {
    const markdown = noteToMarkdown("Run of show", DOC);
    const note = markdownToNote(markdown);
    expect(note.title).toBe("Run of show");
    expect(stored(note.content)).toEqual(stored(DOC));
  });

  it("writes the same Markdown again from what it read", () => {
    const markdown = noteToMarkdown("Run of show", DOC);
    const note = markdownToNote(markdown);
    expect(noteToMarkdown(note.title, stored(note.content))).toBe(markdown);
  });

  it("keeps a heading that isn't the title, and drops one that repeats it", () => {
    expect(markdownToNote("# Agenda\n\nHi", "Minutes")).toMatchObject({
      title: "Minutes",
      content: { content: [{ type: "heading", attrs: { level: 1 } }, p(t("Hi"))] },
    });
    expect(markdownToNote("# Minutes\n\nHi", "Minutes").content).toEqual({
      type: "doc",
      content: [p(t("Hi"))],
    });
    expect(markdownToNote("Hi").title).toBe("");
  });

  it("gives an empty note one empty paragraph", () => {
    expect(stored(markdownToNote("").content)).toEqual(stored({ type: "doc", content: [p()] }));
    expect(stored(markdownToNote("# Only a title").content)).toEqual(
      stored({ type: "doc", content: [p()] }),
    );
  });

  it("fits whatever Markdown it's given to the note schema", () => {
    const awkward = [
      "- [ ] a checklist item",
      "- a plain item in the same list",
      "",
      "1. ```",
      "   code first in an item",
      "   ```",
      "",
      "- - a list in a list",
      "",
      "> > a quote in a quote",
      "",
      "| one | two |",
      "| --- | --- |",
      "| only one cell |",
      "",
      "**`code in bold`** and [`code in a link`](https://example.com)",
      "",
      "Footnote[^1] and [a reference][ref].",
      "",
      "[^1]: The note.",
      "[ref]: https://example.com/ref",
      "",
      "<div>raw html</div>",
    ].join("\n");
    const { json } = checkNoteContent(markdownToNote(awkward).content);
    expect(JSON.stringify(json)).toContain("a reference");
    expect(JSON.stringify(json)).toContain("https://example.com/ref");
    expect(JSON.stringify(json)).toContain("<div>raw html</div>");
  });

  it("keeps only safe links, and turns images into links", () => {
    const note = markdownToNote(
      [
        "[ok](https://example.com) [mail](mailto:a@example.edu) [app](/app/robotics)",
        "[script](javascript:alert(1)) [other](//evil.example/x) [data](data:text/html,hi)",
        "![a cat](https://cats.example/cat.png) ![](javascript:alert(1))",
      ].join("\n\n"),
    );
    const [safe, unsafe, images] = note.content.content!;
    expect(safe).toEqual(
      p(
        t("ok", [link("https://example.com")]),
        t(" "),
        t("mail", [link("mailto:a@example.edu")]),
        t(" "),
        t("app", [link("/app/robotics")]),
      ),
    );
    expect(unsafe).toEqual(p(t("script"), t(" "), t("other"), t(" "), t("data")));
    expect(images).toEqual(
      p(t("a cat", [link("https://cats.example/cat.png")]), t(" "), t("Image")),
    );
  });
});
