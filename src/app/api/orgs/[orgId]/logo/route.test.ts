// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/context", async () =>
  (await import("@/test/fake-context")).fakeContextModule(),
);
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  rateLimitKey: (...parts: string[]) => parts.join(":"),
}));
const { getSessionMock, storeImageMock, deleteStoredImageMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  storeImageMock: vi.fn(),
  deleteStoredImageMock: vi.fn(async () => undefined),
}));
vi.mock("@/lib/auth/session", () => ({ getSession: getSessionMock }));
vi.mock("@/server/images", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/images")>()),
  storeImage: storeImageMock,
  deleteStoredImage: deleteStoredImageMock,
}));

const { fake, resetFake } = await import("@/test/fake-context");
const { ImageRejectedError } = await import("@/server/images");
const { POST, DELETE } = await import("./route");

const params = Promise.resolve({ orgId: "org_1" });
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

function upload(bytes: Buffer, headers: Record<string, string> = {}) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], "logo.png", { type: "image/png" }));
  return new Request("http://localhost/api/orgs/org_1/logo", {
    method: "POST",
    body: form,
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({ user: { id: "u1", email: "u1@example.edu", name: null } });
  resetFake({
    role: "ADMIN",
    db: {
      organization: {
        findUniqueOrThrow: vi.fn(async () => ({ logo: { key: "logos/org_1/old" } })),
        update: vi.fn(),
      },
      $queryRaw: vi.fn(async () => [{ id: "audit" }]),
    },
  });
  storeImageMock.mockResolvedValue({
    key: "logos/org_1/new",
    s64: "/api/dev/blob/logos/org_1/new/s64.webp",
    s256: "/api/dev/blob/logos/org_1/new/s256.webp",
    s512: "/api/dev/blob/logos/org_1/new/s512.webp",
    updatedAt: "2026-09-24T00:00:00.000Z",
  });
});

describe("logo upload route", () => {
  it("needs a session and OWNER/ADMIN", async () => {
    getSessionMock.mockResolvedValue(null);
    expect((await POST(upload(PNG), { params })).status).toBe(401);
    getSessionMock.mockResolvedValue({ user: { id: "u1", email: "x@example.edu", name: null } });
    fake.role = "MEMBER";
    expect((await POST(upload(PNG), { params })).status).toBe(403);
    expect(storeImageMock).not.toHaveBeenCalled();
  });

  it("refuses a cross-site POST", async () => {
    const res = await POST(upload(PNG, { origin: "https://evil.example" }), { params });
    expect(res.status).toBe(403);
  });

  it("answers 413 from Content-Length before reading the body", async () => {
    const req = new Request("http://localhost/api/orgs/org_1/logo", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=x",
        "content-length": String(6 * 1024 * 1024),
      },
      body: "x",
    });
    expect((await POST(req, { params })).status).toBe(413);
    expect(storeImageMock).not.toHaveBeenCalled();
  });

  it("rejects a non-image (e.g. SVG) with 415", async () => {
    storeImageMock.mockRejectedValue(
      new ImageRejectedError("type", "Upload a JPEG, PNG or WebP image."),
    );
    const res = await POST(upload(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")), {
      params,
    });
    expect(res.status).toBe(415);
    expect(fake.db.organization.update).not.toHaveBeenCalled();
  });

  it("stores the variants first, then the row, then deletes the old variants", async () => {
    const res = await POST(upload(PNG), { params });
    expect(res.status).toBe(200);
    expect(storeImageMock).toHaveBeenCalledWith("logos", "org_1", "logo", expect.any(Buffer));
    expect(fake.db.organization.update).toHaveBeenCalledWith({
      where: { id: "org_1" },
      data: { logo: expect.objectContaining({ key: "logos/org_1/new" }) },
    });
    expect(deleteStoredImageMock).toHaveBeenCalledWith({ key: "logos/org_1/old" });
  });

  it("deletes the new variants when the row write fails", async () => {
    fake.db.organization.update.mockRejectedValue(new Error("db down"));
    await expect(POST(upload(PNG), { params })).rejects.toThrow("db down");
    expect(deleteStoredImageMock).toHaveBeenCalledWith(
      expect.objectContaining({ key: "logos/org_1/new" }),
    );
  });

  it("DELETE clears the logo and removes its variants", async () => {
    const res = await DELETE(
      new Request("http://localhost/api/orgs/org_1/logo", { method: "DELETE" }),
      {
        params,
      },
    );
    expect(res.status).toBe(200);
    expect(deleteStoredImageMock).toHaveBeenCalledWith({ key: "logos/org_1/old" });
  });
});
