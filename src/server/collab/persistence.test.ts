// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { NoteVisibility, Role } from "@/generated/prisma/enums";
import { applyContentToState, noteStateToContent, seedNoteState } from "@/lib/collab/note-doc";
import { NOTE_FIELD } from "@/lib/collab/protocol";
import type { MemberContext } from "@/server/db/context";

import { loadNoteState, storeNoteState } from "./persistence";

/**
 * The bridge's load and store against a mocked transaction client, as the
 * user withOrgTxAs opened. The database half of the same rules (policy 6.8
 * on the yjsState column) is P-COLLAB-01 in prisma/rls/phases.mjs.
 */

const db = { note: { findFirst: vi.fn(), updateMany: vi.fn() } };

function ctxAs(userId: string, role: Role = Role.MEMBER): MemberContext {
  return {
    kind: "action",
    db: db as unknown as MemberContext["db"],
    userId,
    organizationId: "org_1",
    role,
    afterCommit: () => undefined,
  };
}

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

/** A live editor appending to the first paragraph. */
function type(state: Uint8Array, text: string) {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, state);
  const paragraph = ydoc.getXmlFragment(NOTE_FIELD).get(0) as Y.XmlElement;
  const ytext = paragraph.get(0) as Y.XmlText;
  ytext.insert(ytext.length, text);
  return Y.encodeStateAsUpdate(ydoc);
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    authorId: "author_1",
    visibility: NoteVisibility.ORGANIZATION,
    contentJson: doc("Minutes"),
    yjsState: null,
    version: 4,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.note.updateMany.mockResolvedValue({ count: 1 });
});

describe("loadNoteState", () => {
  it("looks the note up in the caller's org and hides another author's PRIVATE note", async () => {
    db.note.findFirst.mockResolvedValue(row({ visibility: NoteVisibility.PRIVATE }));
    expect(await loadNoteState(ctxAs("owner_1", Role.OWNER), "note_1")).toBeNull();
    expect(db.note.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "note_1", organizationId: "org_1", deletedAt: null },
      }),
    );
    expect(await loadNoteState(ctxAs("author_1"), "note_1")).not.toBeNull();
  });

  it("returns the stored state, or seeds one from contentJson", async () => {
    const stored = type(seedNoteState(doc("Minutes")), " v2");
    db.note.findFirst.mockResolvedValue(row({ yjsState: stored }));
    expect(noteStateToContent((await loadNoteState(ctxAs("m"), "note_1"))!).text).toBe(
      "Minutes v2",
    );

    db.note.findFirst.mockResolvedValue(row());
    const seeded = await loadNoteState(ctxAs("m"), "note_1");
    expect(Buffer.from(seeded!).equals(Buffer.from(seedNoteState(doc("Minutes"))))).toBe(true);
  });
});

describe("storeNoteState", () => {
  it("refuses a user who cannot see the note, and one who cannot edit it", async () => {
    db.note.findFirst.mockResolvedValue(row({ visibility: NoteVisibility.PRIVATE }));
    const live = type(seedNoteState(doc("Minutes")), " edited");
    expect(await storeNoteState(ctxAs("admin_1", Role.ADMIN), "note_1", live)).toEqual({
      ok: false,
      reason: "not_found",
    });

    db.note.findFirst.mockResolvedValue(row());
    expect(await storeNoteState(ctxAs("member_1"), "note_1", live)).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(await storeNoteState(ctxAs("treasurer_1", Role.TREASURER), "note_1", live)).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(db.note.updateMany).not.toHaveBeenCalled();
  });

  it("saves the body, its text for search, the state, the writer and a new version", async () => {
    db.note.findFirst.mockResolvedValue(row());
    const live = type(seedNoteState(doc("Minutes")), " edited");

    const result = await storeNoteState(ctxAs("admin_1", Role.ADMIN), "note_1", live);

    expect(result).toEqual({ ok: true, version: 5, missing: null });
    const { where, data } = db.note.updateMany.mock.calls[0][0];
    expect(where).toEqual({ id: "note_1", organizationId: "org_1", version: 4 });
    expect(data).toMatchObject({
      contentJson: doc("Minutes edited"),
      contentText: "Minutes edited",
      updatedById: "admin_1",
      version: { increment: 1 },
    });
    expect(noteStateToContent(data.yjsState).text).toBe("Minutes edited");
  });

  it("writes nothing when the body has not changed", async () => {
    db.note.findFirst.mockResolvedValue(row());
    const result = await storeNoteState(ctxAs("author_1"), "note_1", seedNoteState(doc("Minutes")));
    expect(result).toEqual({ ok: true, version: null, missing: null });
    expect(db.note.updateMany).not.toHaveBeenCalled();
  });

  it("merges an autosave that landed meanwhile, and hands it back", async () => {
    const stored = seedNoteState(doc("Minutes"));
    const autosaved = applyContentToState(stored, doc("Minutes (draft)"));
    db.note.findFirst.mockResolvedValue(
      row({ yjsState: autosaved, contentJson: doc("Minutes (draft)") }),
    );
    const live = type(stored, " edited");

    const result = await storeNoteState(ctxAs("author_1"), "note_1", live);

    expect(result.ok && result.missing).toBeTruthy();
    const text = db.note.updateMany.mock.calls[0][0].data.contentText as string;
    expect(text).toContain("(draft)");
    expect(text).toContain("edited");
  });

  it("reads again when the row changed between read and write, then gives up", async () => {
    db.note.findFirst.mockResolvedValue(row());
    db.note.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    const live = type(seedNoteState(doc("Minutes")), " edited");
    expect((await storeNoteState(ctxAs("author_1"), "note_1", live)).ok).toBe(true);
    expect(db.note.findFirst).toHaveBeenCalledTimes(2);

    db.note.updateMany.mockResolvedValue({ count: 0 });
    expect(await storeNoteState(ctxAs("author_1"), "note_1", live)).toEqual({
      ok: false,
      reason: "conflict",
    });
  });
});
