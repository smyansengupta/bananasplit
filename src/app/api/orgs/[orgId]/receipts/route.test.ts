// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, getSessionMock, putMock, deleteMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  putMock: vi.fn(),
  deleteMock: vi.fn(),
  prismaMock: {
    membership: { findUnique: vi.fn() },
    transaction: { findFirst: vi.fn() },
    receipt: { create: vi.fn() },
  },
}));
vi.mock("@/lib/auth/session", () => ({ getSession: getSessionMock }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/finance/receipt-storage", () => ({
  putReceipt: putMock,
  deleteReceipt: deleteMock,
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: true }),
  rateLimitKey: (...parts: string[]) => parts.join(":"),
}));

const { POST, maxDuration } = await import("./route");

const MB = 1024 * 1024;

function jpegOfSize(bytes: number): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(bytes);
  data.set([0xff, 0xd8, 0xff, 0xe0]);
  return data;
}

function upload(
  file: { bytes: Uint8Array<ArrayBuffer>; name: string; type: string } | null,
  opts: { transactionId?: string; origin?: string } = {},
) {
  const form = new FormData();
  if (file) form.set("file", new File([file.bytes], file.name, { type: file.type }));
  form.set("transactionId", opts.transactionId ?? "txn_1");
  const headers = new Headers();
  if (opts.origin) headers.set("origin", opts.origin);
  const request = new Request("http://localhost:3000/api/orgs/org_1/receipts", {
    method: "POST",
    body: form,
    headers,
  });
  return POST(request, { params: Promise.resolve({ orgId: "org_1" }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({ user: { id: "member_1", email: "m@example.edu", name: "M" } });
  prismaMock.membership.findUnique.mockResolvedValue({ role: "MEMBER" });
  prismaMock.transaction.findFirst.mockResolvedValue({ id: "txn_1", submittedById: "member_1" });
  prismaMock.receipt.create.mockResolvedValue({ id: "receipt_1" });
  putMock.mockImplementation(async (key: string) => ({ blobKey: `blob:${key}` }));
});

describe("POST /api/orgs/[orgId]/receipts (0A Fix 15)", () => {
  it("allows a minute for large uploads", () => {
    expect(maxDuration).toBe(60);
  });

  it("accepts a 3.5 MB photo", async () => {
    const response = await upload({
      bytes: jpegOfSize(3.5 * MB),
      name: "IMG_1.jpg",
      type: "image/jpeg",
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ receiptId: "receipt_1" });
  });

  it("refuses a 4.5 MB file with 413 and a clear message, storing nothing", async () => {
    const response = await upload({
      bytes: jpegOfSize(4.5 * MB),
      name: "IMG_2.jpg",
      type: "image/jpeg",
    });

    expect(response.status).toBe(413);
    expect((await response.json()).error).toMatch(/capped at 4 MB/);
    expect(putMock).not.toHaveBeenCalled();
    expect(prismaMock.receipt.create).not.toHaveBeenCalled();
  });

  it("keys the blob by org, transaction and a random id, never the client file name", async () => {
    await upload({ bytes: jpegOfSize(1024), name: "../../etc/passwd.jpg", type: "image/jpeg" });

    const key = putMock.mock.calls[0]?.[0] as string;
    expect(key).toMatch(/^receipts\/org_1\/txn_1\/[0-9a-f-]{36}\.jpg$/);
    expect(prismaMock.receipt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org_1",
          transactionId: "txn_1",
          filename: "../../etc/passwd.jpg",
          mimeType: "image/jpeg",
          uploadedById: "member_1",
        }),
      }),
    );
  });

  it("deletes the blob again when the row cannot be written", async () => {
    prismaMock.receipt.create.mockRejectedValue(new Error("db down"));

    await expect(
      upload({ bytes: jpegOfSize(1024), name: "r.jpg", type: "image/jpeg" }),
    ).rejects.toThrow("db down");
    const key = putMock.mock.calls[0]?.[0] as string;
    expect(deleteMock).toHaveBeenCalledWith(`blob:${key}`);
  });

  it("requires a session and membership", async () => {
    getSessionMock.mockResolvedValue(null);
    expect(
      (await upload({ bytes: jpegOfSize(10), name: "r.jpg", type: "image/jpeg" })).status,
    ).toBe(401);

    getSessionMock.mockResolvedValue({
      user: { id: "outsider", email: "o@example.edu", name: null },
    });
    prismaMock.membership.findUnique.mockResolvedValue(null);
    expect(
      (await upload({ bytes: jpegOfSize(10), name: "r.jpg", type: "image/jpeg" })).status,
    ).toBe(404);
  });

  it("only the submitter or OWNER/TREASURER may attach", async () => {
    prismaMock.transaction.findFirst.mockResolvedValue({
      id: "txn_1",
      submittedById: "someone_else",
    });
    const response = await upload({ bytes: jpegOfSize(10), name: "r.jpg", type: "image/jpeg" });
    expect(response.status).toBe(403);
  });

  it("looks the transaction up inside the org", async () => {
    prismaMock.transaction.findFirst.mockResolvedValue(null);
    const response = await upload(
      { bytes: jpegOfSize(10), name: "r.jpg", type: "image/jpeg" },
      { transactionId: "foreign" },
    );
    expect(response.status).toBe(404);
    expect(prismaMock.transaction.findFirst).toHaveBeenCalledWith({
      where: { id: "foreign", organizationId: "org_1" },
      select: { id: true, submittedById: true },
    });
  });

  it("rejects a file whose bytes are not an image or PDF", async () => {
    const response = await upload({
      bytes: new TextEncoder().encode("#!/bin/sh\necho hi\n"),
      name: "receipt.jpg",
      type: "image/jpeg",
    });
    expect(response.status).toBe(415);
    expect(putMock).not.toHaveBeenCalled();
  });

  it("refuses a cross-site POST", async () => {
    const response = await upload(
      { bytes: jpegOfSize(10), name: "r.jpg", type: "image/jpeg" },
      { origin: "https://evil.example" },
    );
    expect(response.status).toBe(403);
    expect(getSessionMock).not.toHaveBeenCalled();
  });
});
