// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The receipt upload route against fake wrappers: withOrgTx / withOrgAction
 * hand the handler a mocked transaction client and the caller's role (or
 * throw NotFoundError for a non-member, like set_context does), and the
 * storage calls are mocked. The real policies are covered by
 * finance.db.test.ts.
 */

const { state, db, getSessionMock, putBlobMock, deleteMock, txKinds } = vi.hoisted(() => ({
  state: { role: "MEMBER" as string, member: true },
  getSessionMock: vi.fn(),
  putBlobMock: vi.fn(),
  deleteMock: vi.fn(),
  txKinds: [] as string[],
  db: {
    transaction: { findFirst: vi.fn() },
    receipt: { create: vi.fn() },
  },
}));

vi.mock("@/lib/auth/session", () => ({ getSession: getSessionMock }));
vi.mock("@/server/db/context", async () => {
  const { NotFoundError } = await import("@/lib/auth/errors");
  const run = async (kind: string, organizationId: string, fn: (ctx: unknown) => unknown) => {
    const session = await getSessionMock();
    if (!state.member) throw new NotFoundError();
    txKinds.push(kind);
    return fn({ kind, db, userId: session.user.id, organizationId, role: state.role });
  };
  return {
    withOrgTx: (organizationId: string, fn: (ctx: unknown) => unknown) =>
      run("page", organizationId, fn),
    withOrgAction:
      (handler: (ctx: unknown, ...args: unknown[]) => unknown) =>
      (organizationId: string, ...args: unknown[]) =>
        run("action", organizationId, (ctx) => handler(ctx, ...args)),
  };
});
vi.mock("@/server/storage", () => ({ putBlob: putBlobMock }));
vi.mock("@/lib/finance/receipt-storage", () => ({ deleteReceiptBlobs: deleteMock }));
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
  txKinds.length = 0;
  state.role = "MEMBER";
  state.member = true;
  getSessionMock.mockResolvedValue({ user: { id: "member_1", email: "m@example.edu", name: "M" } });
  db.transaction.findFirst.mockResolvedValue({ id: "txn_1", submittedById: "member_1" });
  db.receipt.create.mockResolvedValue({ id: "receipt_1" });
  putBlobMock.mockImplementation(async (kind: string, scopeId: string, segments: string[]) => ({
    key: [kind, scopeId, ...segments].join("/"),
    url: null,
  }));
});

describe("POST /api/orgs/[orgId]/receipts (0A Fix 15, 0C wrappers)", () => {
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
    expect(putBlobMock).not.toHaveBeenCalled();
    expect(db.receipt.create).not.toHaveBeenCalled();
  });

  it("stores under the receipts kind, keyed by org, transaction and a random id, never the file name", async () => {
    await upload({ bytes: jpegOfSize(1024), name: "../../etc/passwd.jpg", type: "image/jpeg" });

    const [kind, scopeId, segments, , options] = putBlobMock.mock.calls[0] as [
      string,
      string,
      string[],
      Buffer,
      { contentType: string },
    ];
    expect(kind).toBe("receipts");
    expect(scopeId).toBe("org_1");
    expect(segments[0]).toBe("txn_1");
    expect(segments[1]).toMatch(/^[0-9a-f-]{36}\.jpg$/);
    expect(options).toEqual({ contentType: "image/jpeg" });
    expect(db.receipt.create).toHaveBeenCalledWith({
      data: {
        organizationId: "org_1",
        uploadedById: "member_1",
        transactionId: "txn_1",
        blobKey: `receipts/org_1/txn_1/${segments[1]}`,
        filename: "../../etc/passwd.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 1024,
      },
      select: { id: true },
    });
  });

  it("reads in one transaction, puts the blob outside any, then writes in another", async () => {
    const order: string[] = [];
    db.transaction.findFirst.mockImplementation(async () => {
      order.push("read");
      return { id: "txn_1", submittedById: "member_1" };
    });
    putBlobMock.mockImplementation(async () => {
      order.push("put");
      return { key: "receipts/org_1/txn_1/x.jpg", url: null };
    });
    db.receipt.create.mockImplementation(async () => {
      order.push("write");
      return { id: "receipt_1" };
    });

    await upload({ bytes: jpegOfSize(1024), name: "r.jpg", type: "image/jpeg" });

    expect(order).toEqual(["read", "put", "write"]);
    // membership check, read, write: the write runs with action semantics.
    expect(txKinds).toEqual(["page", "page", "action"]);
  });

  it("deletes the blob again when the row cannot be written", async () => {
    db.receipt.create.mockRejectedValue(new Error("db down"));

    await expect(
      upload({ bytes: jpegOfSize(1024), name: "r.jpg", type: "image/jpeg" }),
    ).rejects.toThrow("db down");
    const segments = putBlobMock.mock.calls[0]?.[2] as string[];
    expect(deleteMock).toHaveBeenCalledWith([`receipts/org_1/${segments.join("/")}`]);
  });

  it("requires a session and membership", async () => {
    getSessionMock.mockResolvedValue(null);
    expect(
      (await upload({ bytes: jpegOfSize(10), name: "r.jpg", type: "image/jpeg" })).status,
    ).toBe(401);

    getSessionMock.mockResolvedValue({
      user: { id: "outsider", email: "o@example.edu", name: null },
    });
    state.member = false;
    expect(
      (await upload({ bytes: jpegOfSize(10), name: "r.jpg", type: "image/jpeg" })).status,
    ).toBe(404);
    expect(putBlobMock).not.toHaveBeenCalled();
  });

  it("only the submitter or OWNER/TREASURER may attach", async () => {
    db.transaction.findFirst.mockResolvedValue({ id: "txn_1", submittedById: "someone_else" });
    const response = await upload({ bytes: jpegOfSize(10), name: "r.jpg", type: "image/jpeg" });
    expect(response.status).toBe(403);

    state.role = "TREASURER";
    const asTreasurer = await upload({ bytes: jpegOfSize(10), name: "r.jpg", type: "image/jpeg" });
    expect(asTreasurer.status).toBe(201);
  });

  it("looks the transaction up inside the org", async () => {
    db.transaction.findFirst.mockResolvedValue(null);
    const response = await upload(
      { bytes: jpegOfSize(10), name: "r.jpg", type: "image/jpeg" },
      { transactionId: "foreign" },
    );
    expect(response.status).toBe(404);
    expect(db.transaction.findFirst).toHaveBeenCalledWith({
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
    expect(putBlobMock).not.toHaveBeenCalled();
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
