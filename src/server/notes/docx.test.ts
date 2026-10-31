// @vitest-environment node
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { noteFilename, renderNoteDocx } from "./docx";

/** The document's XML, from the .docx zip. */
async function documentXml(input: Parameters<typeof renderNoteDocx>[0]) {
  const buffer = await renderNoteDocx(input);
  const files = unzipSync(new Uint8Array(buffer));
  return {
    body: strFromU8(files["word/document.xml"]!),
    header: Object.entries(files)
      .filter(([name]) => name.startsWith("word/header"))
      .map(([, bytes]) => strFromU8(bytes))
      .join(""),
  };
}

const base = {
  orgName: "Robotics Club",
  baseUrl: "https://app.example/app/robotics",
  orgId: "org_1",
};

describe("renderNoteDocx", () => {
  it("writes the title, the body and the organization in the header, on Letter by default", async () => {
    const { body, header } = await documentXml({
      ...base,
      title: "Run of show",
      paperSize: null,
      contentJson: {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Timeline" }] },
          { type: "paragraph", content: [{ type: "text", text: "Doors at 6:30" }] },
          { type: "pageBreak" },
          { type: "taskChip", attrs: { taskId: "t1", title: "Book a photographer" } },
        ],
      },
    });
    expect(body).toContain("Run of show");
    expect(body).toContain("Timeline");
    expect(body).toContain("Doors at 6:30");
    expect(body).toContain("Book a photographer");
    expect(body).toContain('w:type="page"');
    // Letter: 8.5 × 11 in, in twips.
    expect(body).toMatch(/w:w="12240"/);
    expect(body).toMatch(/w:h="15840"/);
    expect(header).toContain("Robotics Club");
  });

  it("uses A4 when the note does, and shows suggestions as tracked-style marks", async () => {
    const { body } = await documentXml({
      ...base,
      title: "Plan",
      paperSize: "A4",
      contentJson: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "old", marks: [{ type: "suggestionDelete" }] },
              { type: "text", text: "new", marks: [{ type: "suggestionInsert" }] },
            ],
          },
        ],
      },
    });
    expect(body).toMatch(/w:w="11906"/);
    expect(body).toContain("<w:strike/>");
    expect(body).toContain("<w:u ");
  });

  it("names the file after the note", () => {
    expect(noteFilename("Q3 / budget", "docx")).toBe("Q3 - budget.docx");
    expect(noteFilename("  ", "md")).toBe("Untitled note.md");
  });
});
