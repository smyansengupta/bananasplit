import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";

import { noteSchemaExtensions } from "@/lib/notes/schema-extensions";

import {
  applyContentToState,
  InvalidNoteContentError,
  noteStateToContent,
  reconcileNoteState,
  sameContent,
  seedClientId,
  seedNoteState,
} from "./note-doc";
import { NOTE_FIELD } from "./protocol";

/**
 * The Yjs <-> contentJson/contentText mapping behind live saves. What must
 * hold: a live save writes what an autosave of the same document would
 * (search reads contentText), and no path ever duplicates the note's text
 * when two copies of the document meet.
 */

const minutes: JSONContent = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Minutes" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Budget " },
        { type: "text", marks: [{ type: "bold" }], text: "approved" },
      ],
    },
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [{ type: "paragraph", content: [{ type: "text", text: "Book the room" }] }],
        },
      ],
    },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableHeader",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Item" }] }],
            },
            {
              type: "tableCell",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Pizza" }] }],
            },
          ],
        },
      ],
    },
  ],
};

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
});

/** What the autosave editor would save for `content`. */
function autosaveOf(content: JSONContent) {
  const editor = new Editor({ extensions: noteSchemaExtensions(), content });
  editors.push(editor);
  return { json: editor.getJSON(), text: editor.getText() };
}

function docOf(...updates: Uint8Array[]) {
  const doc = new Y.Doc();
  for (const u of updates) Y.applyUpdate(doc, u);
  return doc;
}

/** A live editor typing into the paragraph at `index` (a fresh Yjs client). */
function typeInto(state: Uint8Array, index: number, at: number, text: string) {
  const doc = docOf(state);
  const paragraph = doc.getXmlFragment(NOTE_FIELD).get(index) as Y.XmlElement;
  (paragraph.get(0) as Y.XmlText).insert(at, text);
  return Y.encodeStateAsUpdate(doc);
}

const textOf = (state: Uint8Array) => noteStateToContent(state).text;
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("seeding and reading back", () => {
  it("writes exactly what an autosave of the same document writes", () => {
    const content = noteStateToContent(seedNoteState(minutes));
    const autosave = autosaveOf(minutes);
    expect(content.json).toEqual(autosave.json);
    expect(content.text).toBe(autosave.text);
    expect(content.text).toContain("Budget approved");
  });

  it("seeds the same content to the same bytes, so a second seed merges to nothing", () => {
    const a = seedNoteState(minutes);
    const b = seedNoteState(JSON.parse(JSON.stringify(minutes)));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(textOf(Y.encodeStateAsUpdate(docOf(a, b)))).toBe(textOf(a));
    // Key order does not matter (jsonb reorders keys).
    expect(seedClientId({ content: minutes.content, type: "doc" })).toBe(seedClientId(minutes));
    expect(seedClientId(minutes)).not.toBe(seedClientId({ type: "doc", content: [] }));
  });

  it("survives a collaboration server restart: editors that reconnect do not duplicate the note", () => {
    const seeded = seedNoteState(minutes);
    // An editor typed while the server held the seed, then the server restarted
    // before saving and seeded again from the unchanged row.
    const editor = typeInto(seeded, 1, 0, "Final ");
    const merged = Y.encodeStateAsUpdate(docOf(seedNoteState(minutes), editor));
    expect(count(textOf(merged), "Minutes")).toBe(1);
    expect(textOf(merged)).toContain("Final Budget approved");
  });

  it("reads an empty document as one empty paragraph, like the editor", () => {
    expect(noteStateToContent(Y.encodeStateAsUpdate(new Y.Doc()))).toEqual({
      json: { type: "doc", content: [{ type: "paragraph" }] },
      text: "",
    });
  });

  it("seeds content that does not fit the schema as an empty note", () => {
    expect(noteStateToContent(seedNoteState({})).json).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    expect(() => applyContentToState(seedNoteState(minutes), { type: "nope" })).toThrow(
      InvalidNoteContentError,
    );
  });

  it("compares content regardless of key order", () => {
    expect(sameContent({ a: 1, b: [{ c: 2, d: 3 }] }, { b: [{ d: 3, c: 2 }], a: 1 })).toBe(true);
    expect(sameContent({ a: 1 }, { a: 2 })).toBe(false);
  });
});

describe("autosaves into a live note", () => {
  it("applies an autosave as an edit that merges with concurrent live typing", () => {
    const stored = seedNoteState(minutes);
    const autosaved = structuredClone(minutes);
    autosaved.content![0].content![0].text = "Minutes (draft)";
    const withAutosave = applyContentToState(stored, autosaved);
    expect(textOf(withAutosave)).toContain("Minutes (draft)");

    // Meanwhile someone typed live into the paragraph below.
    const live = typeInto(stored, 1, 0, "Final ");
    const merged = textOf(Y.encodeStateAsUpdate(docOf(withAutosave, live)));
    expect(merged).toContain("Minutes (draft)");
    expect(merged).toContain("Final Budget approved");
    expect(count(merged, "Book the room")).toBe(1);
  });
});

describe("reconciling a live save with the row", () => {
  it("first live save: the live document is the state, nothing missing", () => {
    const live = typeInto(seedNoteState(minutes), 1, 0, "Final ");
    const { state, missing } = reconcileNoteState(live, { yjsState: null, contentJson: minutes });
    expect(textOf(state)).toContain("Final Budget approved");
    expect(missing).toBeNull();
  });

  it("merges what the row gained meanwhile and hands it back to the live document", () => {
    const stored = seedNoteState(minutes);
    const autosaved = structuredClone(minutes);
    autosaved.content![0].content![0].text = "Minutes (draft)";
    const row = applyContentToState(stored, autosaved);
    const live = typeInto(stored, 1, 0, "Final ");

    const { state, missing } = reconcileNoteState(live, { yjsState: row, contentJson: autosaved });
    expect(textOf(state)).toContain("Minutes (draft)");
    expect(textOf(state)).toContain("Final Budget approved");
    expect(missing).not.toBeNull();
    // Applying the missing part brings the live document to the saved state.
    const liveDoc = docOf(live);
    Y.applyUpdate(liveDoc, missing!);
    expect(textOf(Y.encodeStateAsUpdate(liveDoc))).toBe(textOf(state));
  });

  it("with nothing new in the row, hands nothing back", () => {
    const stored = seedNoteState(minutes);
    const live = typeInto(stored, 1, 0, "Final ");
    expect(reconcileNoteState(live, { yjsState: stored, contentJson: minutes }).missing).toBeNull();
  });

  it("a row changed with collaboration off is applied as an edit, never merged as a second seed", () => {
    const live = typeInto(seedNoteState(minutes), 1, 0, "Final ");
    const changed = structuredClone(minutes);
    changed.content![0].content![0].text = "Agenda";
    const { state } = reconcileNoteState(live, { yjsState: null, contentJson: changed });
    const text = textOf(state);
    expect(text).toContain("Agenda");
    expect(count(text, "Book the room")).toBe(1);
    expect(count(text, "Minutes")).toBe(0);
  });
});
