import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Note actions against a fake withOrgAction that hands the handler a mocked
 * transaction client, like the real wrapper does after set_context. The
 * database side of the same rules (policy 6.8) is covered by
 * notes.db.test.ts and the RLS suites.
 */

const { state, db } = vi.hoisted(() => ({
  state: { userId: "member_1", role: "MEMBER" as string },
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
          afterCommit: () => undefined,
        },
        ...args,
      ),
}));

const { Role, NoteVisibility } = await import("@/generated/prisma/enums");
const { createNote, updateNote, deleteNote, restoreNote } = await import("./actions");

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
  actAs(MEMBER_ID, Role.MEMBER);
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
