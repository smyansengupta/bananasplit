import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Comment and version actions against a fake withOrgAction that hands the
 * handler a mocked transaction client, like actions.test.ts. Pins the
 * app's side of the rules (RLS repeats them, migration
 * 20261019120000_moonstone_product_update): who may comment, resolve,
 * edit, delete, save, rename, delete and restore versions, and that every
 * read and write stays in the caller's org.
 */

const { state, db, notifyUsers } = vi.hoisted(() => ({
  state: { userId: "member_1", role: "MEMBER" as string, afterCommit: vi.fn() },
  db: {
    note: { findFirst: vi.fn(), updateMany: vi.fn() },
    noteComment: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    noteVersion: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    membership: { findMany: vi.fn() },
    noteShare: { findMany: vi.fn() },
    organization: { findUnique: vi.fn() },
  },
  notifyUsers: vi.fn(),
}));

vi.mock("@/server/notifications", () => ({ notifyUsers }));
vi.mock("@/server/db/context", () => ({
  withOrgAction:
    (handler: (ctx: unknown, ...args: unknown[]) => Promise<unknown>) =>
    async (organizationId: string, ...args: unknown[]) =>
      handler(
        {
          kind: "action",
          db,
          user: { id: state.userId, email: `${state.userId}@example.edu`, name: "Ana Kim" },
          userId: state.userId,
          organizationId,
          role: state.role,
          afterCommit: state.afterCommit,
        },
        ...args,
      ),
}));

const { Role, NoteVisibility, NoteShareRole, NotificationType } =
  await import("@/generated/prisma/enums");
const { addNoteComment, editNoteComment, resolveNoteThread, deleteNoteComment } =
  await import("./comment-actions");
const {
  saveNamedVersion,
  renameNoteVersion,
  deleteNoteVersion,
  restoreNoteVersion,
  getNoteVersion,
} = await import("./version-actions");

const AUTHOR = "author_1";
const ME = "member_1";
const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

function note(overrides: Record<string, unknown> = {}) {
  return {
    id: "note_1",
    title: "Run of show",
    authorId: AUTHOR,
    visibility: NoteVisibility.ORGANIZATION,
    memberCanEdit: false,
    shares: [],
    contentJson: doc("Doors at 6:30"),
    contentText: "Doors at 6:30",
    version: 4,
    yjsState: null,
    ...overrides,
  };
}

function actAs(userId: string, role: string) {
  state.userId = userId;
  state.role = role;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  actAs(ME, Role.MEMBER);
  db.noteComment.findMany.mockResolvedValue([]);
  db.noteVersion.findMany.mockResolvedValue([]);
  db.noteShare.findMany.mockResolvedValue([]);
  db.membership.findMany.mockResolvedValue([]);
  db.organization.findUnique.mockResolvedValue({ slug: "robotics" });
});

describe("comments", () => {
  it("looks the note up in the caller's org, and refuses a private note they can't see", async () => {
    db.note.findFirst.mockResolvedValue(note({ visibility: NoteVisibility.PRIVATE }));
    const result = await addNoteComment("org_1", "note_1", { body: "Hi" });
    expect(result.error).toMatch(/not found/i);
    expect(db.note.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "note_1", organizationId: "org_1", deletedAt: null },
      }),
    );
    expect(db.noteComment.create).not.toHaveBeenCalled();
  });

  it("lets anyone who can see the note comment (a viewer too), as themselves, in the org", async () => {
    db.note.findFirst.mockResolvedValue(note());
    db.noteComment.create.mockResolvedValue({ id: "c1" });
    const result = await addNoteComment("org_1", "note_1", {
      body: "Three rounds of four?",
      anchorText: "two rounds of six",
      anchor: { from: 3, to: 20, prefix: "the ", suffix: " teams" },
    });
    expect(result.error).toBeUndefined();
    expect(db.noteComment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org_1",
        noteId: "note_1",
        authorId: ME,
        threadId: null,
        anchorText: "two rounds of six",
      }),
      select: { id: true },
    });
  });

  it("replies only to a thread's first comment on the same note and org", async () => {
    db.note.findFirst.mockResolvedValue(note());
    db.noteComment.findFirst.mockResolvedValue(null);
    const result = await addNoteComment("org_1", "note_1", { body: "Yes", threadId: "reply_9" });
    expect(result.error).toMatch(/thread/i);
    expect(db.noteComment.findFirst).toHaveBeenCalledWith({
      where: { id: "reply_9", noteId: "note_1", organizationId: "org_1", threadId: null },
      select: { id: true, authorId: true },
    });
  });

  it("tells the note's author about a new comment, in their Inbox", async () => {
    db.note.findFirst.mockResolvedValue(note({ authorId: "u_author" }));
    db.noteComment.create.mockResolvedValue({ id: "c1" });
    db.noteShare.findMany.mockResolvedValue([]);
    db.membership.findMany.mockResolvedValue([{ userId: "u_author" }]);
    await addNoteComment("org_1", "note_1", { body: "Looks good" });
    expect(notifyUsers).toHaveBeenCalledWith(
      db,
      "org_1",
      ["u_author"],
      expect.objectContaining({
        type: NotificationType.TASK_COMMENTED,
        linkUrl: "/app/robotics/notes/note_1?comment=c1",
      }),
    );
  });

  it("tells whoever a private note is shared with, not the commenter", async () => {
    db.note.findFirst.mockResolvedValue(note({ visibility: NoteVisibility.PRIVATE, authorId: ME }));
    db.noteComment.create.mockResolvedValue({ id: "c1" });
    db.noteShare.findMany.mockResolvedValue([{ userId: "u_shared" }]);
    db.membership.findMany.mockResolvedValue([{ userId: "u_shared" }]);
    await addNoteComment("org_1", "note_1", { body: "Noted" });
    expect(notifyUsers).toHaveBeenCalledTimes(1);
    expect(notifyUsers).toHaveBeenCalledWith(
      db,
      "org_1",
      ["u_shared"],
      expect.objectContaining({ type: NotificationType.TASK_COMMENTED }),
    );
  });

  it("tells @mentioned members who can read the note, and nobody else", async () => {
    db.note.findFirst.mockResolvedValue(note({ visibility: NoteVisibility.PRIVATE, authorId: ME }));
    db.noteComment.create.mockResolvedValue({ id: "c1" });
    // Both are members; only u_shared has the private note shared with them.
    db.membership.findMany.mockResolvedValue([{ userId: "u_shared" }, { userId: "u_other" }]);
    db.noteShare.findMany.mockResolvedValue([{ userId: "u_shared" }]);
    await addNoteComment("org_1", "note_1", {
      body: "@Sam @Riley look",
      mentions: ["u_shared", "u_other", ME],
    });
    expect(notifyUsers).toHaveBeenCalledTimes(1);
    expect(notifyUsers).toHaveBeenCalledWith(
      db,
      "org_1",
      ["u_shared"],
      expect.objectContaining({
        type: NotificationType.TASK_MENTIONED,
        linkUrl: "/app/robotics/notes/note_1?comment=c1",
      }),
    );
  });

  it("only someone who can edit the note resolves a thread", async () => {
    db.note.findFirst.mockResolvedValue(note());
    const refused = await resolveNoteThread("org_1", "note_1", "c1", true);
    expect(refused.error).toMatch(/edit/i);
    expect(db.noteComment.updateMany).not.toHaveBeenCalled();

    db.note.findFirst.mockResolvedValue(note({ memberCanEdit: true }));
    db.noteComment.updateMany.mockResolvedValue({ count: 1 });
    const ok = await resolveNoteThread("org_1", "note_1", "c1", true);
    expect(ok.error).toBeUndefined();
    expect(db.noteComment.updateMany).toHaveBeenCalledWith({
      where: { id: "c1", noteId: "note_1", organizationId: "org_1", threadId: null },
      data: expect.objectContaining({ resolvedById: ME }),
    });
  });

  it("an editor by share resolves too, and reopening clears who resolved it", async () => {
    db.note.findFirst.mockResolvedValue(
      note({ visibility: NoteVisibility.PRIVATE, shares: [{ role: NoteShareRole.EDITOR }] }),
    );
    db.noteComment.updateMany.mockResolvedValue({ count: 1 });
    await resolveNoteThread("org_1", "note_1", "c1", false);
    expect(db.noteComment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ resolvedAt: null, resolvedById: null }),
      }),
    );
  });

  it("changes a comment only for its author", async () => {
    db.note.findFirst.mockResolvedValue(note());
    db.noteComment.updateMany.mockResolvedValue({ count: 0 });
    const result = await editNoteComment("org_1", "note_1", "c1", "Edited");
    expect(result.error).toMatch(/wrote/i);
    expect(db.noteComment.updateMany).toHaveBeenCalledWith({
      where: { id: "c1", noteId: "note_1", organizationId: "org_1", authorId: ME },
      data: expect.objectContaining({ body: "Edited" }),
    });
  });

  it("deletes someone else's comment only for whoever may share the note", async () => {
    db.note.findFirst.mockResolvedValue(note());
    db.noteComment.findFirst.mockResolvedValue({ authorId: "someone_else" });
    const refused = await deleteNoteComment("org_1", "note_1", "c1");
    expect(refused.error).toMatch(/author/i);
    expect(db.noteComment.deleteMany).not.toHaveBeenCalled();

    // An admin, on a club note, may share it.
    actAs("admin_1", Role.ADMIN);
    const ok = await deleteNoteComment("org_1", "note_1", "c1");
    expect(ok.error).toBeUndefined();
    expect(db.noteComment.deleteMany).toHaveBeenCalledWith({
      where: { id: "c1", noteId: "note_1", organizationId: "org_1" },
    });
  });

  it("refuses an anchor that isn't one", async () => {
    db.note.findFirst.mockResolvedValue(note());
    const result = await addNoteComment("org_1", "note_1", {
      body: "x",
      anchor: { from: 9, to: 2 },
    });
    expect(result.error).toBeTruthy();
    expect(db.noteComment.create).not.toHaveBeenCalled();
  });
});

describe("versions", () => {
  it("names the current version only for someone who can edit, as themselves", async () => {
    db.note.findFirst.mockResolvedValue(note());
    const refused = await saveNamedVersion("org_1", "note_1", "Final");
    expect(refused.error).toMatch(/permission/i);
    expect(db.noteVersion.create).not.toHaveBeenCalled();

    actAs(AUTHOR, Role.MEMBER);
    const ok = await saveNamedVersion("org_1", "note_1", "Final", JSON.stringify(doc("Live body")));
    expect(ok.error).toBeUndefined();
    expect(db.noteVersion.create).toHaveBeenCalledWith({
      data: {
        organizationId: "org_1",
        noteId: "note_1",
        name: "Final",
        createdById: AUTHOR,
        contentJson: doc("Live body"),
      },
    });
  });

  it("refuses a body that doesn't fit the note schema", async () => {
    actAs(AUTHOR, Role.MEMBER);
    db.note.findFirst.mockResolvedValue(note());
    const result = await saveNamedVersion(
      "org_1",
      "note_1",
      "Bad",
      JSON.stringify({ type: "doc", content: [{ type: "nope" }] }),
    );
    expect(result.error).toMatch(/invalid/i);
  });

  it("reads and renames versions inside the caller's org and note", async () => {
    db.note.findFirst.mockResolvedValue(note());
    db.noteVersion.findFirst.mockResolvedValue(null);
    expect((await getNoteVersion("org_1", "note_1", "v_other_org")).error).toMatch(/no longer/);
    expect(db.noteVersion.findFirst).toHaveBeenCalledWith({
      where: { id: "v_other_org", noteId: "note_1", organizationId: "org_1" },
      select: { contentJson: true, name: true },
    });

    actAs(AUTHOR, Role.MEMBER);
    db.noteVersion.updateMany.mockResolvedValue({ count: 1 });
    await renameNoteVersion("org_1", "note_1", "v1", "Kickoff");
    expect(db.noteVersion.updateMany).toHaveBeenCalledWith({
      where: { id: "v1", noteId: "note_1", organizationId: "org_1" },
      data: { name: "Kickoff" },
    });
  });

  it("deletes a version only for whoever may share the note", async () => {
    db.note.findFirst.mockResolvedValue(note({ memberCanEdit: true }));
    expect((await deleteNoteVersion("org_1", "note_1", "v1")).error).toMatch(/author/);
    expect(db.noteVersion.deleteMany).not.toHaveBeenCalled();
    actAs(AUTHOR, Role.MEMBER);
    await deleteNoteVersion("org_1", "note_1", "v1");
    expect(db.noteVersion.deleteMany).toHaveBeenCalledWith({
      where: { id: "v1", noteId: "note_1", organizationId: "org_1" },
    });
  });

  it("restores on the autosave path: keeps the current body, writes the version, version-checked", async () => {
    actAs(AUTHOR, Role.MEMBER);
    db.note.findFirst.mockResolvedValue(note());
    db.noteVersion.findFirst.mockResolvedValue({
      contentJson: doc("Earlier"),
      createdAt: new Date(),
      name: "Kickoff",
    });
    db.note.updateMany.mockResolvedValue({ count: 1 });
    const result = await restoreNoteVersion("org_1", "note_1", "v1", {
      live: false,
      expectedVersion: 4,
    });
    expect(result.error).toBeUndefined();
    expect(result.version).toBe(5);
    // The body it replaced, as a snapshot first.
    expect(db.noteVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: null, contentJson: doc("Doors at 6:30") }),
    });
    expect(db.note.updateMany).toHaveBeenCalledWith({
      where: { id: "note_1", organizationId: "org_1", version: 4 },
      data: expect.objectContaining({ contentJson: doc("Earlier"), contentText: "Earlier" }),
    });
  });

  it("restores in a live note by handing the body to the editor, writing no body", async () => {
    actAs(AUTHOR, Role.MEMBER);
    db.note.findFirst.mockResolvedValue(note());
    db.noteVersion.findFirst.mockResolvedValue({
      contentJson: doc("Earlier"),
      createdAt: new Date(),
      name: null,
    });
    const result = await restoreNoteVersion("org_1", "note_1", "v1", { live: true });
    expect(result.contentJson).toEqual(doc("Earlier"));
    expect(db.note.updateMany).not.toHaveBeenCalled();
  });

  it("reports a conflict when the note moved on", async () => {
    actAs(AUTHOR, Role.MEMBER);
    db.note.findFirst.mockResolvedValue(note());
    db.noteVersion.findFirst.mockResolvedValue({
      contentJson: doc("Earlier"),
      createdAt: new Date(),
      name: null,
    });
    db.note.updateMany.mockResolvedValue({ count: 0 });
    const result = await restoreNoteVersion("org_1", "note_1", "v1", {
      live: false,
      expectedVersion: 3,
    });
    expect(result.conflict).toBe(true);
  });

  it("a viewer can't restore", async () => {
    db.note.findFirst.mockResolvedValue(note());
    const result = await restoreNoteVersion("org_1", "note_1", "v1", { live: false });
    expect(result.error).toMatch(/permission/i);
    expect(db.noteVersion.findFirst).not.toHaveBeenCalled();
  });
});
