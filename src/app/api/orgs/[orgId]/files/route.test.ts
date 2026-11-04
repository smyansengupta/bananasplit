// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Notes upload route's gate (redesign guide 11.2): it now asks the
 * space, as actions do, before reading the body, and answers in numbers.
 */

const { getSessionMock, storeMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  storeMock: vi.fn(),
}));

vi.mock("@/server/db/context", async () =>
  (await import("@/test/fake-context")).fakeContextModule(),
);
vi.mock("@/lib/auth/session", () => ({ getSession: getSessionMock, requireUser: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: true }),
  rateLimitKey: (...parts: string[]) => parts.join(":"),
  retryAfterText: () => "soon",
}));
vi.mock("@/server/notes/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/notes/files")>()),
  storeNoteFile: storeMock,
}));

const { fake, resetFake } = await import("@/test/fake-context");
const { POST } = await import("./route");

const MB = 1024 * 1024;
let org: Record<string, unknown> = {};

function post(bytes: number, headers: Record<string, string> = {}) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes).fill(65)], "notes.txt", { type: "text/plain" }));
  const request = new Request("http://localhost:3000/api/orgs/org_1/files", {
    method: "POST",
    body: form,
    headers,
  });
  return POST(request, { params: Promise.resolve({ orgId: "org_1" }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  org = {
    id: "org_1",
    slug: "me",
    name: "Me",
    kind: "PERSONAL",
    plan: "FREE",
    trialEndsAt: null,
    storageUsedBytes: BigInt(0),
  };
  resetFake({
    role: "OWNER",
    db: { organization: { findUnique: vi.fn(async () => org) } },
  });
  getSessionMock.mockResolvedValue({ user: { id: "actor" } });
  storeMock.mockResolvedValue({ id: "file_1", name: "notes.txt" });
});

describe("POST /api/orgs/[orgId]/files", () => {
  it("lets a Personal Free space upload a note file", async () => {
    const res = await post(1024);
    expect(res.status).toBe(200);
    expect(storeMock).toHaveBeenCalledTimes(1);
    expect(fake.db.organization.findUnique).toHaveBeenCalled();
  });

  it("holds an ended trial to Team Free's largest file, before the body is read", async () => {
    org = { ...org, kind: "CLUB", plan: "TRIAL", trialEndsAt: new Date(Date.now() - 1000) };
    const res = await post(1024, { "content-length": String(120 * MB) });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: "FILE_TOO_LARGE", maxFileBytes: 100 * MB });
    expect(storeMock).not.toHaveBeenCalled();
  });

  it("refuses a file over the plan's largest, from its declared length, with the numbers", async () => {
    const res = await post(1024, { "content-length": String(13 * MB) });
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body).toMatchObject({ code: "FILE_TOO_LARGE", maxFileBytes: 10 * MB });
    expect(body.error).toBe("This file is 13 MB. Your plan allows files up to 10 MB.");
    expect(storeMock).not.toHaveBeenCalled();
  });

  it("refuses a full space", async () => {
    org = { ...org, storageUsedBytes: BigInt(1024 ** 3) };
    const res = await post(1024, { "content-length": String(200 * 1024) });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("STORAGE_FULL");
  });

  it("hides a space from a non-member", async () => {
    fake.db.organization.findUnique = vi.fn(async () => null);
    const res = await post(10);
    expect(res.status).toBe(404);
  });
});
