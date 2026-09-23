import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { canEditEvent, eventInclude } = await import("./queries");

describe("eventInclude — linked notes follow the notes rules (0A Fix 11)", () => {
  it("never includes deleted notes, and PRIVATE notes only for their author", () => {
    const include = eventInclude("viewer_1");
    expect(include.notes.where).toEqual({
      deletedAt: null,
      OR: [{ visibility: "ORGANIZATION" }, { authorId: "viewer_1" }],
    });
    expect(include.notes.select).toEqual({ id: true, title: true });
  });
});

describe("canEditEvent (0A Fix 8)", () => {
  const event = { createdById: "creator" };

  it("allows the creator and OWNER/ADMIN", () => {
    expect(canEditEvent(event, { userId: "creator", role: "MEMBER" })).toBe(true);
    expect(canEditEvent(event, { userId: "x", role: "OWNER" })).toBe(true);
    expect(canEditEvent(event, { userId: "x", role: "ADMIN" })).toBe(true);
  });

  it("refuses everyone else, TREASURER included", () => {
    expect(canEditEvent(event, { userId: "x", role: "MEMBER" })).toBe(false);
    expect(canEditEvent(event, { userId: "x", role: "TREASURER" })).toBe(false);
  });
});
