// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The note PDF download: session required, the note read through the same
 * visibility filter as the page (RLS repeats it in the database, covered by
 * notes.db.test.ts), rate-limited, and never cacheable.
 */

vi.mock("@/server/db/context", async () =>
  (await import("@/test/fake-context")).fakeContextModule(),
);
const { getSessionMock, rateLimitMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  rateLimitMock: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ getSession: getSessionMock }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: rateLimitMock,
  rateLimitKey: (...parts: string[]) => parts.join(":"),
}));
vi.mock("@/server/notes/pdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/notes/pdf")>();
  return { ...actual, renderNotePdf: vi.fn(actual.renderNotePdf) };
});

const { resetFake } = await import("@/test/fake-context");
const { renderNotePdf } = await import("@/server/notes/pdf");
const { GET } = await import("./route");

const member = { id: "user_1", email: "member@example.edu", name: "Member" };

const note = {
  id: "note_1",
  title: "Q3 planning / budget",
  contentJson: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
  },
  contentText: "Hello",
  visibility: "ORGANIZATION",
  authorId: "author_1",
  updatedAt: new Date("2026-10-01T15:00:00Z"),
  author: { id: "author_1", name: "Jordan Lee", email: "jordan@example.edu", image: null },
  event: null,
};

function call(orgSlug = "cbc", noteId = "note_1") {
  return GET(new Request(`http://localhost/app/${orgSlug}/notes/${noteId}/pdf`), {
    params: Promise.resolve({ orgSlug, noteId }),
  });
}

let findFirst: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  findFirst = vi.fn(async () => note);
  resetFake({
    userId: member.id,
    role: "MEMBER",
    db: {
      $queryRaw: vi.fn(async () => [{ organizationId: "org_1" }]),
      note: { findFirst },
      organization: {
        findUniqueOrThrow: vi.fn(async () => ({
          name: "Claude Builders Club",
          timezone: "America/New_York",
        })),
      },
    },
  });
  getSessionMock.mockResolvedValue({ user: member });
  rateLimitMock.mockResolvedValue({ allowed: true });
});

describe("GET /app/[orgSlug]/notes/[noteId]/pdf", () => {
  it("returns the note as a PDF attachment that is never cached", async () => {
    const res = await call();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="Q3 planning - budget.pdf"; filename*=UTF-8''Q3%20planning%20-%20budget.pdf`,
    );
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("reads the note with the caller's visibility filter", async () => {
    await call();

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "note_1",
          organizationId: "org_1",
          deletedAt: null,
          OR: [{ visibility: "ORGANIZATION" }, { authorId: member.id }],
        }),
      }),
    );
  });

  it("puts the author's name in the PDF, never their email", async () => {
    await call();
    expect(vi.mocked(renderNotePdf)).toHaveBeenCalledWith(
      expect.objectContaining({ authorName: "Jordan Lee", orgName: "Claude Builders Club" }),
    );

    findFirst.mockResolvedValueOnce({ ...note, author: { ...note.author, name: null } });
    await call();
    const input = vi.mocked(renderNotePdf).mock.calls.at(-1)![0];
    expect(input.authorName).toBe("Unknown author");
    expect(JSON.stringify(input)).not.toContain("jordan@example.edu");
  });

  it("401s without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("404s for an unknown org", async () => {
    resetFake({ userId: member.id, db: { $queryRaw: vi.fn(async () => []), note: { findFirst } } });
    const res = await call("nope");
    expect(res.status).toBe(404);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("404s for a note the caller can't see", async () => {
    findFirst.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
    expect(renderNotePdf).not.toHaveBeenCalled();
  });

  it("429s past the rate limit, before reading the note", async () => {
    rateLimitMock.mockResolvedValue({ allowed: false, retryAfterMs: 90_000 });
    const res = await call();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("90");
    expect(findFirst).not.toHaveBeenCalled();
  });
});
