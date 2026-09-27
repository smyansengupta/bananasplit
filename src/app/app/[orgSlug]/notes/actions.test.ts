import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Note actions against a fake withOrgAction that hands the handler a mocked
 * transaction client, like the real wrapper does after set_context. The
 * database side of the same rules (policy 6.8) is covered by
 * notes.db.test.ts and the RLS suites.
 */

const { state, db } = vi.hoisted(() => ({
  state: { userId: "member_1", role: "MEMBER" as string, afterCommit: vi.fn() },
  db: {
    note: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    event: { findFirst: vi.fn() },
  },
}));

vi.mock("@/server/db/context", () => ({
  withOrgAction:
    (handler: (ctx: unknown, ...args: unknown[]) => Promise<unknown>) =>
    async (organizationId: string, ...args: unknown[]) =>
      handler(
        {
          kind: "action",
          db,
          user: { id: state.userId, email: `${state.userId}@example.edu`, name: null },
          userId: state.userId,
          organizationId,
          role: state.role,
          afterCommit: state.afterCommit,
        },
        ...args,
      ),
}));

const { Role, NoteVisibility } = await import("@/generated/prisma/enums");
const { createNote, updateNote, deleteNote, restoreNote, updateNoteDetails, issueNoteCollabToken } =
  await import("./actions");
const { verifyCollabToken } = await import("@/lib/collab/token");
const { noteStateToContent, seedNoteState } = await import("@/lib/collab/note-doc");

const OWNER_ID = "owner_1";
const MEMBER_ID = "member_1";

function actAs(userId: string, role: string) {
  state.userId = userId;
  state.role = role;
}

const validInput = {
  title: "Updated title",
  contentJson: JSON.stringify({ type: "doc", content: [] }),
  contentText: "hello",
  visibility: NoteVisibility.ORGANIZATION,
  eventId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  actAs(MEMBER_ID, Role.MEMBER);
});

const COLLAB_SECRET = "c".repeat(40);

/** Live collaboration on, as the deployment would set it. */
function enableCollab() {
  vi.stubEnv("COLLAB_ENABLED", "true");
  vi.stubEnv("COLLAB_SERVER_URL", "wss://collab.example.org");
  vi.stubEnv("COLLAB_SECRET", COLLAB_SECRET);
}

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

describe("updateNote — visibility enforcement (spec 3.3)", () => {
  it("returns not-found for an OWNER fetching another member's private note", async () => {
    actAs(OWNER_ID, Role.OWNER);
    db.note.findFirst.mockResolvedValue({
      id: "note_1",
      authorId: MEMBER_ID,
      visibility: NoteVisibility.PRIVATE,
    });

    const result = await updateNote("org_1", "note_1", validInput, 1);

    expect(result.error).toMatch(/not found/i);
    expect(db.note.updateMany).not.toHaveBeenCalled();
  });

  it("lets the author see and update their own private note", async () => {
    db.note.findFirst.mockResolvedValue({
      id: "note_1",
      authorId: MEMBER_ID,
      visibility: NoteVisibility.PRIVATE,
    });
    db.note.updateMany.mockResolvedValue({ count: 1 });

    const result = await updateNote("org_1", "note_1", validInput, 1);

    expect(result.error).toBeUndefined();
    expect(result.version).toBe(2);
    expect(db.note.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "note_1", organizationId: "org_1", version: 1 },
        data: expect.objectContaining({ updatedById: MEMBER_ID, version: { increment: 1 } }),
      }),
    );
  });

  it("looks the note up inside the caller's org", async () => {
    db.note.findFirst.mockResolvedValue(null);
    await updateNote("org_1", "note_x", validInput, 1);
    expect(db.note.findFirst).toHaveBeenCalledWith({
      where: { id: "note_x", organizationId: "org_1", deletedAt: null },
    });
  });
});

describe("updateNote — edit permission", () => {
  it("rejects a MEMBER editing another member's organization-visible note", async () => {
    db.note.findFirst.mockResolvedValue({
      id: "note_1",
      authorId: "someone_else",
      visibility: NoteVisibility.ORGANIZATION,
    });

    const result = await updateNote("org_1", "note_1", validInput, 1);

    expect(result.error).toMatch(/don't have permission/i);
    expect(db.note.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a TREASURER editing another member's note (finance authority only)", async () => {
    actAs("treasurer_1", Role.TREASURER);
    db.note.findFirst.mockResolvedValue({
      id: "note_1",
      authorId: MEMBER_ID,
      visibility: NoteVisibility.ORGANIZATION,
    });

    const result = await updateNote("org_1", "note_1", validInput, 1);

    expect(result.error).toMatch(/don't have permission/i);
    expect(db.note.updateMany).not.toHaveBeenCalled();
  });

  it("allows an OWNER to edit another member's organization-visible note", async () => {
    actAs(OWNER_ID, Role.OWNER);
    db.note.findFirst.mockResolvedValue({
      id: "note_1",
      authorId: MEMBER_ID,
      visibility: NoteVisibility.ORGANIZATION,
    });
    db.note.updateMany.mockResolvedValue({ count: 1 });

    const result = await updateNote("org_1", "note_1", validInput, 3);

    expect(result.error).toBeUndefined();
    expect(result.version).toBe(4);
  });

  it("rejects an event from another org before writing", async () => {
    db.note.findFirst.mockResolvedValue({
      id: "note_1",
      authorId: MEMBER_ID,
      visibility: NoteVisibility.PRIVATE,
    });
    db.event.findFirst.mockResolvedValue(null);

    const result = await updateNote("org_1", "note_1", { ...validInput, eventId: "event_x" }, 1);

    expect(result.error).toMatch(/event doesn't exist/i);
    expect(db.event.findFirst).toHaveBeenCalledWith({
      where: { id: "event_x", organizationId: "org_1", deletedAt: null },
      select: { id: true },
    });
    expect(db.note.updateMany).not.toHaveBeenCalled();
  });
});

describe("updateNote — optimistic concurrency (spec 3.2)", () => {
  it("surfaces a conflict when the version has moved on since the client loaded it", async () => {
    db.note.findFirst.mockResolvedValue({
      id: "note_1",
      authorId: MEMBER_ID,
      visibility: NoteVisibility.PRIVATE,
    });
    db.note.updateMany.mockResolvedValue({ count: 0 });

    const result = await updateNote("org_1", "note_1", validInput, 1);

    expect(result.conflict).toBe(true);
    expect(result.error).toMatch(/updated by someone else/i);
  });
});

describe("deleteNote / restoreNote", () => {
  it("returns not-found for a non-author trying to delete another member's private note", async () => {
    actAs(OWNER_ID, Role.OWNER);
    db.note.findFirst.mockResolvedValue({
      id: "note_1",
      authorId: MEMBER_ID,
      visibility: NoteVisibility.PRIVATE,
    });

    const result = await deleteNote("org_1", "note_1");

    expect(result.error).toMatch(/not found/i);
    expect(db.note.updateMany).not.toHaveBeenCalled();
  });

  it("soft-deletes the author's note inside the org", async () => {
    db.note.findFirst.mockResolvedValue({
      id: "note_1",
      authorId: MEMBER_ID,
      visibility: NoteVisibility.ORGANIZATION,
    });
    db.note.updateMany.mockResolvedValue({ count: 1 });

    expect(await deleteNote("org_1", "note_1")).toEqual({});
    expect(db.note.updateMany).toHaveBeenCalledWith({
      where: { id: "note_1", organizationId: "org_1" },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it("restores for an ADMIN and refuses a MEMBER who is not the author", async () => {
    db.note.findFirst.mockResolvedValue({
      id: "note_1",
      authorId: "someone_else",
      visibility: NoteVisibility.ORGANIZATION,
    });
    expect((await restoreNote("org_1", "note_1")).error).toMatch(/don't have permission/i);

    actAs("admin_1", Role.ADMIN);
    db.note.updateMany.mockResolvedValue({ count: 1 });
    expect(await restoreNote("org_1", "note_1")).toEqual({});
    expect(db.note.updateMany).toHaveBeenCalledWith({
      where: { id: "note_1", organizationId: "org_1" },
      data: { deletedAt: null },
    });
  });
});

describe("createNote", () => {
  it("creates a PRIVATE note authored by the caller", async () => {
    db.note.create.mockResolvedValue({ id: "note_new" });

    const result = await createNote("org_1", { title: "  Board minutes " });

    expect(result).toEqual({ noteId: "note_new" });
    expect(db.note.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org_1",
          title: "Board minutes",
          visibility: NoteVisibility.PRIVATE,
          authorId: MEMBER_ID,
          updatedById: MEMBER_ID,
        }),
      }),
    );
  });

  it("refuses a prefill event from another org", async () => {
    db.event.findFirst.mockResolvedValue(null);
    const result = await createNote("org_1", { eventId: "event_x" });
    expect(result.error).toMatch(/event doesn't exist/i);
    expect(db.note.create).not.toHaveBeenCalled();
  });
});

// ---- Live collaboration (docs/features/collaboration.md) ----

describe("issueNoteCollabToken — who may join a note live", () => {
  const claimsOf = (result: Awaited<ReturnType<typeof issueNoteCollabToken>>) =>
    result.error === undefined ? verifyCollabToken(result.session.token, COLLAB_SECRET) : null;

  it("is refused while collaboration is off", async () => {
    const result = await issueNoteCollabToken("org_1", "note_1");
    expect(result.error).toMatch(/off/i);
    expect(db.note.findFirst).not.toHaveBeenCalled();
  });

  it("returns not-found for another member's PRIVATE note, even to an OWNER", async () => {
    enableCollab();
    actAs(OWNER_ID, Role.OWNER);
    db.note.findFirst.mockResolvedValue({
      id: "note_1",
      authorId: MEMBER_ID,
      visibility: NoteVisibility.PRIVATE,
    });
    expect((await issueNoteCollabToken("org_1", "note_1")).error).toMatch(/not found/i);
  });

  it("looks the note up inside the caller's org, live notes only", async () => {
    enableCollab();
    db.note.findFirst.mockResolvedValue(null);
    expect((await issueNoteCollabToken("org_1", "note_x")).error).toMatch(/not found/i);
    expect(db.note.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "note_x", organizationId: "org_1", deletedAt: null },
      }),
    );
  });

  it("gives a MEMBER a read-only token for someone else's ORGANIZATION note", async () => {
    enableCollab();
    db.note.findFirst.mockResolvedValue({
      id: "note_1",
      authorId: "someone_else",
      visibility: NoteVisibility.ORGANIZATION,
    });
    const result = await issueNoteCollabToken("org_1", "note_1");
    expect(result.error).toBeUndefined();
    expect(claimsOf(result)).toMatchObject({
      sub: MEMBER_ID,
      org: "org_1",
      doc: "note:org_1:note_1",
      perm: "read",
    });
    if (result.error === undefined) {
      expect(result.session.canWrite).toBe(false);
      expect(result.session.url).toBe("wss://collab.example.org");
    }
  });

  it("gives the author, and an ADMIN, a write token; a TREASURER only reads", async () => {
    enableCollab();
    db.note.findFirst.mockResolvedValue({
      id: "note_1",
      authorId: MEMBER_ID,
      visibility: NoteVisibility.PRIVATE,
    });
    expect(claimsOf(await issueNoteCollabToken("org_1", "note_1"))?.perm).toBe("write");

    db.note.findFirst.mockResolvedValue({
      id: "note_1",
      authorId: "someone_else",
      visibility: NoteVisibility.ORGANIZATION,
    });
    actAs("admin_1", Role.ADMIN);
    expect(claimsOf(await issueNoteCollabToken("org_1", "note_1"))?.perm).toBe("write");
    actAs("treasurer_1", Role.TREASURER);
    expect(claimsOf(await issueNoteCollabToken("org_1", "note_1"))?.perm).toBe("read");
  });
});

describe("updateNote — keeping a live note's Yjs state in step", () => {
  const input = (text: string) => ({ ...validInput, contentJson: JSON.stringify(doc(text)) });
  const savedState = () => {
    const data = db.note.updateMany.mock.calls[0][0].data;
    return data.yjsState as Uint8Array | undefined;
  };

  beforeEach(() => db.note.updateMany.mockResolvedValue({ count: 1 }));

  it("writes no Yjs state for a note never edited live while collaboration is off", async () => {
    db.note.findFirst.mockResolvedValue({
      id: "note_1",
      authorId: MEMBER_ID,
      visibility: NoteVisibility.ORGANIZATION,
      contentJson: doc("before"),
      yjsState: null,
    });
    expect((await updateNote("org_1", "note_1", input("after"), 1)).error).toBeUndefined();
    expect(savedState()).toBeUndefined();
  });

  it("applies the autosave to the note's existing Yjs state", async () => {
    db.note.findFirst.mockResolvedValue({
      id: "note_1",
      authorId: MEMBER_ID,
      visibility: NoteVisibility.ORGANIZATION,
      contentJson: doc("before"),
      yjsState: seedNoteState(doc("before")),
    });
    expect((await updateNote("org_1", "note_1", input("after"), 1)).error).toBeUndefined();
    expect(noteStateToContent(savedState()!).text).toBe("after");
  });

  it("with collaboration on, gives a note its state on the first autosave", async () => {
    enableCollab();
    db.note.findFirst.mockResolvedValue({
      id: "note_1",
      authorId: MEMBER_ID,
      visibility: NoteVisibility.ORGANIZATION,
      contentJson: doc("before"),
      yjsState: null,
    });
    await updateNote("org_1", "note_1", input("after"), 1);
    expect(noteStateToContent(savedState()!).text).toBe("after");
  });

  it("refuses content off the note schema when it has to update a state", async () => {
    db.note.findFirst.mockResolvedValue({
      id: "note_1",
      authorId: MEMBER_ID,
      visibility: NoteVisibility.ORGANIZATION,
      contentJson: doc("before"),
      yjsState: seedNoteState(doc("before")),
    });
    const result = await updateNote(
      "org_1",
      "note_1",
      { ...validInput, contentJson: JSON.stringify({ type: "nope" }) },
      1,
    );
    expect(result.error).toMatch(/invalid note content/i);
    expect(db.note.updateMany).not.toHaveBeenCalled();
  });

  it("closes the note's live sessions after commit when it turns PRIVATE", async () => {
    db.note.findFirst.mockResolvedValue({
      id: "note_1",
      authorId: MEMBER_ID,
      visibility: NoteVisibility.ORGANIZATION,
      contentJson: doc("x"),
      yjsState: null,
    });
    await updateNote("org_1", "note_1", { ...validInput, visibility: NoteVisibility.PRIVATE }, 1);
    expect(state.afterCommit).toHaveBeenCalledTimes(1);

    state.afterCommit.mockClear();
    await updateNote("org_1", "note_1", validInput, 2);
    expect(state.afterCommit).not.toHaveBeenCalled();
  });
});

describe("updateNoteDetails — the live editor's save for title, visibility and event", () => {
  beforeEach(() => db.note.updateMany.mockResolvedValue({ count: 1 }));

  it("writes only the fields given, with no version check, and bumps the version", async () => {
    db.note.findFirst.mockResolvedValue({
      authorId: MEMBER_ID,
      visibility: NoteVisibility.PRIVATE,
    });

    expect(await updateNoteDetails("org_1", "note_1", { title: " Renamed " })).toEqual({
      noteId: "note_1",
    });
    expect(db.note.updateMany).toHaveBeenCalledWith({
      where: { id: "note_1", organizationId: "org_1" },
      data: { title: "Renamed", updatedById: MEMBER_ID, version: { increment: 1 } },
    });
    expect(state.afterCommit).not.toHaveBeenCalled();
  });

  it("follows the note rules: not-found for a private note, no edit for another member", async () => {
    actAs(OWNER_ID, Role.OWNER);
    db.note.findFirst.mockResolvedValue({
      authorId: MEMBER_ID,
      visibility: NoteVisibility.PRIVATE,
    });
    expect((await updateNoteDetails("org_1", "note_1", { title: "x" })).error).toMatch(
      /not found/i,
    );

    actAs(MEMBER_ID, Role.MEMBER);
    db.note.findFirst.mockResolvedValue({
      authorId: "someone_else",
      visibility: NoteVisibility.ORGANIZATION,
    });
    expect((await updateNoteDetails("org_1", "note_1", { title: "x" })).error).toMatch(
      /don't have permission/i,
    );
    expect(db.note.updateMany).not.toHaveBeenCalled();
  });

  it("validates the patch and the event, and never takes a body", async () => {
    db.note.findFirst.mockResolvedValue({
      authorId: MEMBER_ID,
      visibility: NoteVisibility.PRIVATE,
    });
    expect((await updateNoteDetails("org_1", "note_1", { title: "  " })).error).toMatch(
      /title is required/i,
    );
    db.event.findFirst.mockResolvedValue(null);
    expect((await updateNoteDetails("org_1", "note_1", { eventId: "event_x" })).error).toMatch(
      /event doesn't exist/i,
    );
    await updateNoteDetails("org_1", "note_1", { contentJson: "{}", contentText: "hijack" });
    expect(db.note.updateMany.mock.calls[0][0].data).not.toHaveProperty("contentText");
  });

  it("closes the note's live sessions after commit when it turns PRIVATE", async () => {
    db.note.findFirst.mockResolvedValue({
      authorId: MEMBER_ID,
      visibility: NoteVisibility.ORGANIZATION,
    });
    await updateNoteDetails("org_1", "note_1", { visibility: NoteVisibility.PRIVATE });
    expect(state.afterCommit).toHaveBeenCalledTimes(1);
  });
});

describe("deleteNote — live sessions", () => {
  it("closes the note's live sessions after commit", async () => {
    db.note.findFirst.mockResolvedValue({
      id: "note_1",
      authorId: MEMBER_ID,
      visibility: NoteVisibility.ORGANIZATION,
    });
    db.note.updateMany.mockResolvedValue({ count: 1 });
    await deleteNote("org_1", "note_1");
    expect(state.afterCommit).toHaveBeenCalledTimes(1);
  });
});
