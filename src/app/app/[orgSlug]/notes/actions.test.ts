import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Note actions against a fake withOrgAction that hands the handler a mocked
 * transaction client, like the real wrapper does after set_context. The
 * database side of the same rules (policy 6.8) is covered by
 * notes.db.test.ts and the RLS suites.
 */

const { state, db, notifyUsers, listNoteShares } = vi.hoisted(() => ({
  state: { userId: "member_1", role: "MEMBER" as string, afterCommit: vi.fn() },
  db: {
    note: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    event: { findFirst: vi.fn() },
    membership: { findMany: vi.fn() },
    noteShare: { findMany: vi.fn(), upsert: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    organization: { findUnique: vi.fn() },
  },
  notifyUsers: vi.fn(),
  listNoteShares: vi.fn(),
}));

vi.mock("@/server/notifications", () => ({ notifyUsers }));
vi.mock("@/server/notes/sharing", () => ({ listNoteShares }));

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

const { Role, NoteVisibility, NoteShareRole } = await import("@/generated/prisma/enums");
const {
  createNote,
  updateNote,
  deleteNote,
  restoreNote,
  updateNoteDetails,
  issueNoteCollabToken,
  updateNoteAccess,
  shareNote,
  updateNoteShare,
  removeNoteShare,
} = await import("./actions");
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
      // The caller's own share, for the sharing rules.
      include: { shares: { where: { userId: MEMBER_ID }, select: { role: true }, take: 1 } },
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

// ---- Sharing --------------------------------------------------------------

/** A note by someone else, optionally shared with the caller. */
function othersNote(
  visibility: (typeof NoteVisibility)[keyof typeof NoteVisibility],
  extra: {
    memberCanEdit?: boolean;
    share?: (typeof NoteShareRole)[keyof typeof NoteShareRole];
  } = {},
) {
  return {
    id: "note_1",
    title: "Budget plan",
    authorId: "someone_else",
    visibility,
    memberCanEdit: extra.memberCanEdit ?? false,
    contentJson: { type: "doc", content: [] },
    shares: extra.share ? [{ role: extra.share }] : [],
  };
}

describe("note sharing — who sees and edits", () => {
  it("lets an EDITOR share edit a private note, and a VIEWER only read it", async () => {
    db.note.findFirst.mockResolvedValue(
      othersNote(NoteVisibility.PRIVATE, { share: NoteShareRole.EDITOR }),
    );
    db.note.updateMany.mockResolvedValue({ count: 1 });
    const { visibility: _v, ...save } = validInput;
    expect((await updateNote("org_1", "note_1", save, 1)).error).toBeUndefined();

    db.note.findFirst.mockResolvedValue(
      othersNote(NoteVisibility.PRIVATE, { share: NoteShareRole.VIEWER }),
    );
    expect((await updateNote("org_1", "note_1", save, 1)).error).toMatch(/don't have permission/i);
  });

  it("hides a private note from someone it isn't shared with", async () => {
    db.note.findFirst.mockResolvedValue(othersNote(NoteVisibility.PRIVATE));
    expect((await updateNote("org_1", "note_1", validInput, 1)).error).toBe("Note not found.");
  });

  it("lets every member edit a club note that allows it", async () => {
    db.note.findFirst.mockResolvedValue(
      othersNote(NoteVisibility.ORGANIZATION, { memberCanEdit: true }),
    );
    db.note.updateMany.mockResolvedValue({ count: 1 });
    expect((await updateNote("org_1", "note_1", validInput, 1)).error).toBeUndefined();
  });

  it("never lets an editor change who sees the note, or delete it", async () => {
    db.note.findFirst.mockResolvedValue(
      othersNote(NoteVisibility.ORGANIZATION, { memberCanEdit: true }),
    );
    const turned = await updateNote(
      "org_1",
      "note_1",
      { ...validInput, visibility: NoteVisibility.PRIVATE },
      1,
    );
    expect(turned.error).toMatch(/author/i);
    expect((await updateNoteDetails("org_1", "note_1", { visibility: "PRIVATE" })).error).toMatch(
      /author/i,
    );
    expect((await deleteNote("org_1", "note_1")).error).toMatch(/permission/i);
    expect((await updateNoteAccess("org_1", "note_1", "CLUB_VIEW")).error).toMatch(/author/i);
    expect(db.note.updateMany).not.toHaveBeenCalled();
  });

  it("gives an EDITOR share a write token", async () => {
    enableCollab();
    const claimsOf = (result: Awaited<ReturnType<typeof issueNoteCollabToken>>) =>
      result.error === undefined ? verifyCollabToken(result.session.token, COLLAB_SECRET) : null;
    db.note.findFirst.mockResolvedValue(
      othersNote(NoteVisibility.PRIVATE, { share: NoteShareRole.EDITOR }),
    );
    expect(claimsOf(await issueNoteCollabToken("org_1", "note_1"))?.perm).toBe("write");
    db.note.findFirst.mockResolvedValue(
      othersNote(NoteVisibility.PRIVATE, { share: NoteShareRole.VIEWER }),
    );
    expect(claimsOf(await issueNoteCollabToken("org_1", "note_1"))?.perm).toBe("read");
  });
});

describe("updateNoteAccess — general access", () => {
  it("lets the author open a note to the club as editors, and closes live sessions", async () => {
    db.note.findFirst.mockResolvedValue({
      ...othersNote(NoteVisibility.PRIVATE),
      authorId: MEMBER_ID,
    });
    db.note.updateMany.mockResolvedValue({ count: 1 });
    expect((await updateNoteAccess("org_1", "note_1", "CLUB_EDIT")).error).toBeUndefined();
    expect(db.note.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "note_1", organizationId: "org_1" },
      data: { visibility: "ORGANIZATION", memberCanEdit: true },
    });
    expect(state.afterCommit).toHaveBeenCalledTimes(1);
  });

  it("lets an admin change a club note's access, but only the author makes it private", async () => {
    actAs("admin_1", Role.ADMIN);
    db.note.findFirst.mockResolvedValue(othersNote(NoteVisibility.ORGANIZATION));
    db.note.updateMany.mockResolvedValue({ count: 1 });
    expect((await updateNoteAccess("org_1", "note_1", "CLUB_EDIT")).error).toBeUndefined();
    expect((await updateNoteAccess("org_1", "note_1", "RESTRICTED")).error).toMatch(/author/i);
    expect(db.note.updateMany).toHaveBeenCalledTimes(1);
  });

  it("refuses an unknown access level", async () => {
    expect((await updateNoteAccess("org_1", "note_1", "EVERYONE")).error).toBeTruthy();
    expect(db.note.findFirst).not.toHaveBeenCalled();
  });
});

describe("shareNote — adding people", () => {
  beforeEach(() => {
    db.note.findFirst.mockResolvedValue({
      ...othersNote(NoteVisibility.PRIVATE),
      authorId: MEMBER_ID,
    });
    db.organization.findUnique.mockResolvedValue({ slug: "cbc" });
    listNoteShares.mockResolvedValue([]);
  });

  it("shares with club members and tells only the people newly added", async () => {
    db.membership.findMany.mockResolvedValue([{ userId: "u_a" }, { userId: "u_b" }]);
    db.noteShare.findMany.mockResolvedValue([{ userId: "u_b", role: NoteShareRole.VIEWER }]);
    const result = await shareNote("org_1", "note_1", {
      userIds: ["u_a", "u_b", MEMBER_ID],
      role: NoteShareRole.EDITOR,
    });
    expect(result.error).toBeUndefined();
    // The author is never a share of their own note.
    expect(db.membership.findMany.mock.calls[0][0].where.userId.in).toEqual(["u_a", "u_b"]);
    expect(db.noteShare.upsert).toHaveBeenCalledTimes(2);
    expect(db.noteShare.upsert.mock.calls[0][0]).toMatchObject({
      where: { noteId_userId: { noteId: "note_1", userId: "u_a" } },
      create: { organizationId: "org_1", role: "EDITOR", createdById: MEMBER_ID },
    });
    expect(notifyUsers).toHaveBeenCalledWith(
      db,
      "org_1",
      ["u_a"],
      expect.objectContaining({ type: "NOTE_SHARED", linkUrl: "/app/cbc/notes/note_1" }),
    );
    // u_b went from viewer to editor: everyone reconnects with the new rights.
    expect(state.afterCommit).toHaveBeenCalledTimes(1);
  });

  it("refuses anyone outside the club, and anyone but the author on a private note", async () => {
    db.membership.findMany.mockResolvedValue([]);
    expect(
      (await shareNote("org_1", "note_1", { userIds: ["stranger"], role: "VIEWER" })).error,
    ).toMatch(/members of the organization/);

    actAs("admin_1", Role.ADMIN);
    db.note.findFirst.mockResolvedValue(
      othersNote(NoteVisibility.PRIVATE, { share: NoteShareRole.EDITOR }),
    );
    expect(
      (await shareNote("org_1", "note_1", { userIds: ["u_a"], role: "VIEWER" })).error,
    ).toMatch(/author/);
    expect(db.noteShare.upsert).not.toHaveBeenCalled();
  });
});

describe("updateNoteShare / removeNoteShare", () => {
  it("changes and removes shares for the author only", async () => {
    db.note.findFirst.mockResolvedValue({
      ...othersNote(NoteVisibility.PRIVATE),
      authorId: MEMBER_ID,
    });
    db.noteShare.updateMany.mockResolvedValue({ count: 1 });
    listNoteShares.mockResolvedValue([]);
    expect((await updateNoteShare("org_1", "note_1", "u_a", "VIEWER")).error).toBeUndefined();
    expect((await removeNoteShare("org_1", "note_1", "u_a")).error).toBeUndefined();
    expect(db.noteShare.deleteMany).toHaveBeenCalledWith({
      where: { noteId: "note_1", userId: "u_a", organizationId: "org_1" },
    });

    db.note.findFirst.mockResolvedValue(
      othersNote(NoteVisibility.PRIVATE, { share: NoteShareRole.EDITOR }),
    );
    expect((await updateNoteShare("org_1", "note_1", "u_a", "EDITOR")).error).toMatch(/author/);
    expect((await removeNoteShare("org_1", "note_1", "u_a")).error).toMatch(/author/);
  });

  it("lets anyone take themselves off a note shared with them", async () => {
    db.note.findFirst.mockResolvedValue(
      othersNote(NoteVisibility.PRIVATE, { share: NoteShareRole.VIEWER }),
    );
    const result = await removeNoteShare("org_1", "note_1", MEMBER_ID);
    expect(result).toEqual({ shares: [] });
    expect(db.noteShare.deleteMany).toHaveBeenCalledWith({
      where: { noteId: "note_1", userId: MEMBER_ID, organizationId: "org_1" },
    });
  });
});
