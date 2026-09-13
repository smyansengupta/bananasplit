import { beforeEach, describe, expect, it, vi } from "vitest";

// updateNote/deleteNote go through withOrgContext, which calls requireUser
// (from session.ts) cross-module — replace that binding rather than the real
// session.ts, which pulls in next-auth and fails to resolve under Vitest.
const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    membership: { findUnique: vi.fn() },
    note: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    event: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { Role, NoteVisibility } = await import("@/generated/prisma/enums");
const { updateNote, deleteNote } = await import("./actions");

const owner = { id: "owner_1", email: "owner@example.edu", name: "Owner" };
const member = { id: "member_1", email: "member@example.edu", name: "Member" };

const validInput = {
  title: "Updated title",
  contentJson: JSON.stringify({ type: "doc", content: [] }),
  contentText: "hello",
  visibility: NoteVisibility.ORGANIZATION,
  eventId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("updateNote — visibility enforcement (spec 3.3)", () => {
  it("returns not-found for an OWNER fetching another member's private note", async () => {
    requireUserMock.mockResolvedValue(owner);
    prismaMock.membership.findUnique.mockResolvedValue({ role: Role.OWNER });
    prismaMock.note.findFirst.mockResolvedValue({
      id: "note_1",
      authorId: member.id,
      visibility: NoteVisibility.PRIVATE,
    });

    const result = await updateNote("org_1", "note_1", validInput, 1);

    expect(result.error).toMatch(/not found/i);
    expect(prismaMock.note.updateMany).not.toHaveBeenCalled();
  });

  it("lets the author see and update their own private note", async () => {
    requireUserMock.mockResolvedValue(member);
    prismaMock.membership.findUnique.mockResolvedValue({ role: Role.MEMBER });
    prismaMock.note.findFirst.mockResolvedValue({
      id: "note_1",
      authorId: member.id,
      visibility: NoteVisibility.PRIVATE,
    });
    prismaMock.note.updateMany.mockResolvedValue({ count: 1 });

    const result = await updateNote("org_1", "note_1", validInput, 1);

    expect(result.error).toBeUndefined();
    expect(result.version).toBe(2);
  });
});

describe("updateNote — edit permission", () => {
  it("rejects a MEMBER editing another member's organization-visible note", async () => {
    requireUserMock.mockResolvedValue(member);
    prismaMock.membership.findUnique.mockResolvedValue({ role: Role.MEMBER });
    prismaMock.note.findFirst.mockResolvedValue({
      id: "note_1",
      authorId: "someone_else",
      visibility: NoteVisibility.ORGANIZATION,
    });

    const result = await updateNote("org_1", "note_1", validInput, 1);

    expect(result.error).toMatch(/don't have permission/i);
    expect(prismaMock.note.updateMany).not.toHaveBeenCalled();
  });

  it("allows an OWNER to edit another member's organization-visible note", async () => {
    requireUserMock.mockResolvedValue(owner);
    prismaMock.membership.findUnique.mockResolvedValue({ role: Role.OWNER });
    prismaMock.note.findFirst.mockResolvedValue({
      id: "note_1",
      authorId: member.id,
      visibility: NoteVisibility.ORGANIZATION,
    });
    prismaMock.note.updateMany.mockResolvedValue({ count: 1 });

    const result = await updateNote("org_1", "note_1", validInput, 3);

    expect(result.error).toBeUndefined();
    expect(result.version).toBe(4);
  });
});

describe("updateNote — optimistic concurrency (spec 3.2)", () => {
  it("surfaces a conflict when the version has moved on since the client loaded it", async () => {
    requireUserMock.mockResolvedValue(member);
    prismaMock.membership.findUnique.mockResolvedValue({ role: Role.MEMBER });
    prismaMock.note.findFirst.mockResolvedValue({
      id: "note_1",
      authorId: member.id,
      visibility: NoteVisibility.PRIVATE,
    });
    prismaMock.note.updateMany.mockResolvedValue({ count: 0 });

    const result = await updateNote("org_1", "note_1", validInput, 1);

    expect(result.conflict).toBe(true);
    expect(result.error).toMatch(/updated by someone else/i);
  });
});

describe("deleteNote — visibility enforcement", () => {
  it("returns not-found for a non-author trying to delete another member's private note", async () => {
    requireUserMock.mockResolvedValue(owner);
    prismaMock.membership.findUnique.mockResolvedValue({ role: Role.OWNER });
    prismaMock.note.findFirst.mockResolvedValue({
      id: "note_1",
      authorId: member.id,
      visibility: NoteVisibility.PRIVATE,
    });

    const result = await deleteNote("org_1", "note_1");

    expect(result.error).toMatch(/not found/i);
    expect(prismaMock.note.update).not.toHaveBeenCalled();
  });
});
