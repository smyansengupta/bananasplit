import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The export download needs session + signature for that user + OWNER at
 * download time + READY, is audited, and is never cacheable.
 */

vi.mock("@/server/db/context", async () =>
  (await import("@/test/fake-context")).fakeContextModule(),
);
const { getSessionMock, getBlobMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getBlobMock: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ getSession: getSessionMock }));
vi.mock("@/server/storage", () => ({ getBlob: getBlobMock }));

const { fake, resetFake } = await import("@/test/fake-context");
const { signExportDownload } = await import("@/server/export/signing");
const { GET } = await import("./route");

const owner = { id: "owner_1", email: "owner@example.edu", name: "Owner" };
const params = Promise.resolve({ orgId: "org_1", exportId: "exp_1" });

function req(link: { exp: number; sig: string }) {
  return new Request(
    `http://localhost/api/orgs/org_1/exports/exp_1/download?exp=${link.exp}&sig=${link.sig}`,
    {
      headers: { "user-agent": "vitest" },
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AUTH_SECRET", "test-secret");
  resetFake({
    userId: owner.id,
    role: "OWNER",
    db: {
      orgExport: {
        findFirst: vi.fn(async () => ({
          status: "READY",
          blobKey: "exports/org_1/exp_1.zip",
          expiresAt: new Date(Date.now() + 86_400_000),
          createdAt: new Date("2026-09-20T00:00:00Z"),
        })),
      },
      organization: { findUnique: vi.fn(async () => ({ slug: "cbc" })) },
    },
    systemDb: {
      orgExport: { update: vi.fn() },
      $queryRaw: vi.fn(async () => [{ id: "audit" }]),
    },
  });
  getSessionMock.mockResolvedValue({ user: owner });
  getBlobMock.mockResolvedValue({ body: Buffer.from("PK zip"), contentType: "application/zip" });
});

describe("GET export download", () => {
  it("refuses a signed-out request", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await GET(req(signExportDownload("exp_1", owner.id)), { params });
    expect(res.status).toBe(401);
    expect(getBlobMock).not.toHaveBeenCalled();
  });

  it("refuses an expired signature", async () => {
    const link = signExportDownload("exp_1", owner.id, Date.now() - 25 * 60 * 60 * 1000);
    expect((await GET(req(link), { params })).status).toBe(403);
  });

  it("refuses a signature minted for another user (a forwarded link)", async () => {
    const link = signExportDownload("exp_1", "someone_else");
    expect((await GET(req(link), { params })).status).toBe(403);
    expect(getBlobMock).not.toHaveBeenCalled();
  });

  it("refuses a tampered signature and another export's signature", async () => {
    const link = signExportDownload("exp_1", owner.id);
    expect(
      (await GET(req({ ...link, sig: link.sig.slice(0, -2) + "xx" }), { params })).status,
    ).toBe(403);
    expect((await GET(req(signExportDownload("exp_2", owner.id)), { params })).status).toBe(403);
  });

  it("refuses a non-OWNER (e.g. an owner who was demoted after the link was minted)", async () => {
    fake.role = "ADMIN";
    const res = await GET(req(signExportDownload("exp_1", owner.id)), { params });
    expect(res.status).toBe(403);
    expect(getBlobMock).not.toHaveBeenCalled();
  });

  it("refuses an export that is not READY", async () => {
    fake.db.orgExport.findFirst.mockResolvedValue({
      status: "EXPIRED",
      blobKey: null,
      expiresAt: new Date(),
      createdAt: new Date(),
    });
    expect((await GET(req(signExportDownload("exp_1", owner.id)), { params })).status).toBe(410);
  });

  it("streams the zip with no-store, counts it and writes an audit row", async () => {
    const res = await GET(req(signExportDownload("exp_1", owner.id)), { params });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="cbc-export-2026-09-20.zip"',
    );
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("PK zip");
    expect(fake.systemCalls).toContainEqual(["org_1", { userId: owner.id }]);
    expect(fake.systemDb.orgExport.update).toHaveBeenCalledWith({
      where: { id: "exp_1" },
      data: { downloadCount: { increment: 1 }, lastDownloadedAt: expect.any(Date) },
    });
    const audit = fake.systemDb.$queryRaw.mock.calls[0];
    expect((audit[0] as TemplateStringsArray).join("?")).toContain("write_org_audit");
    expect(audit[2]).toBe("export.downloaded");
  });
});
