// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Upload validation for /api/profile/avatar (Phase 2): same-site and
 * signed-in checks, the 4 MB cap (413 from Content-Length before the body
 * is read, and from a running count when there is no length), the 10 per
 * hour limit, magic-byte sniffing, and the hand-off to the image pipeline.
 * The pipeline itself (sharp, variants, old-variant deletion after commit)
 * is covered in src/server/images and src/server/profiles.
 */

const { getSessionMock, rateLimitMock, replaceMock, removeMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  rateLimitMock: vi.fn(),
  replaceMock: vi.fn(),
  removeMock: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ getSession: getSessionMock }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: rateLimitMock,
  rateLimitKey: (...parts: string[]) => parts.join(":"),
  retryAfterText: () => "in 12 minutes",
}));
vi.mock("@/server/profiles/service", () => ({
  replaceOwnAvatar: replaceMock,
  removeOwnAvatar: removeMock,
}));

const { ImageRejectedError } = await import("@/server/images");
const { DELETE, POST, maxDuration } = await import("./route");

const MB = 1024 * 1024;
const URL_ = "http://localhost:3402/api/profile/avatar";

function png(bytes: number): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(bytes);
  data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return data;
}

function formRequest(
  file: { bytes: Uint8Array<ArrayBuffer>; name?: string; type?: string } | null,
  headers: Record<string, string> = {},
): Request {
  const form = new FormData();
  if (file) form.set("file", new File([file.bytes], file.name ?? "avatar.png", { type: file.type ?? "image/png" }));
  return new Request(URL_, { method: "POST", body: form, headers });
}

/** A request whose body is never read: proves the 413 comes from the header. */
function headerOnlyRequest(length: number): { request: Request; wasRead: () => boolean } {
  let read = false;
  // highWaterMark 0: pull() runs only when someone actually reads.
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        read = true;
        controller.enqueue(new Uint8Array(1024));
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  const request = new Request(URL_, {
    method: "POST",
    body,
    headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(length) },
    duplex: "half",
  } as RequestInit);
  return { request, wasRead: () => read };
}

const stored = {
  key: "avatars/u_1/abc",
  s64: "/api/dev/blob/avatars/u_1/abc/s64.webp",
  s128: "/api/dev/blob/avatars/u_1/abc/s128.webp",
  s256: "/api/dev/blob/avatars/u_1/abc/s256.webp",
  updatedAt: "2026-09-23T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({ user: { id: "u_1", email: "ada@example.edu", name: "Ada" } });
  rateLimitMock.mockResolvedValue({ allowed: true });
  replaceMock.mockResolvedValue(stored);
  removeMock.mockResolvedValue(undefined);
});

describe("POST /api/profile/avatar", () => {
  it("allows a minute, like every upload route", () => {
    expect(maxDuration).toBe(60);
  });

  it("stores a cropped picture and returns the variants", async () => {
    const response = await POST(formRequest({ bytes: png(300 * 1024) }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ avatar: stored });
    expect(replaceMock).toHaveBeenCalledTimes(1);
    const [userId, bytes] = replaceMock.mock.calls[0];
    expect(userId).toBe("u_1");
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(bytes.length).toBe(300 * 1024);
    expect(rateLimitMock).toHaveBeenCalledWith("avatar-upload:u_1", 10, 3600);
  });

  it("accepts a file just under 4 MB", async () => {
    const response = await POST(formRequest({ bytes: png(4 * MB - 1024) }));
    expect(response.status).toBe(200);
  });

  it("refuses a 4.1 MB upload with 413 from Content-Length, before reading the body or counting a hit", async () => {
    const { request, wasRead } = headerOnlyRequest(Math.round(4.1 * MB) + 70 * 1024);
    const response = await POST(request);
    expect(response.status).toBe(413);
    expect((await response.json()).error).toMatch(/4 MB/);
    expect(wasRead()).toBe(false);
    expect(rateLimitMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("refuses a 4.1 MB file with 413 even when the length header fits the envelope", async () => {
    const response = await POST(formRequest({ bytes: png(Math.round(4.1 * MB)) }));
    expect(response.status).toBe(413);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("refuses a body without a length as soon as it passes the cap", async () => {
    let chunks = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunks++;
        controller.enqueue(new Uint8Array(512 * 1024));
        if (chunks > 20) controller.close();
      },
    });
    const response = await POST(
      new Request(URL_, {
        method: "POST",
        body,
        headers: { "content-type": "multipart/form-data; boundary=x" },
        duplex: "half",
      } as RequestInit),
    );
    expect(response.status).toBe(413);
    expect(chunks).toBeLessThan(15);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("sniffs the bytes and never trusts the declared type", async () => {
    const script = new TextEncoder().encode("<svg onload=alert(1)>") as Uint8Array<ArrayBuffer>;
    const response = await POST(formRequest({ bytes: script, name: "a.png", type: "image/png" }));
    expect(response.status).toBe(415);
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]) as Uint8Array<ArrayBuffer>;
    expect((await POST(formRequest({ bytes: gif, type: "image/png" }))).status).toBe(415);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("maps an image the pipeline cannot read to 422", async () => {
    replaceMock.mockRejectedValueOnce(new ImageRejectedError("corrupt", "That image could not be read."));
    const response = await POST(formRequest({ bytes: png(1024) }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "That image could not be read." });
  });

  it("does not leak internal errors", async () => {
    replaceMock.mockRejectedValueOnce(new Error("connection refused 10.0.0.1"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await POST(formRequest({ bytes: png(1024) }));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toMatch(/10\.0\.0\.1/);
  });

  it("requires a signed-in user", async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const response = await POST(formRequest({ bytes: png(1024) }));
    expect(response.status).toBe(401);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("refuses a cross-site request", async () => {
    const response = await POST(formRequest({ bytes: png(1024) }, { origin: "https://evil.example" }));
    expect(response.status).toBe(403);
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it("limits uploads to 10 an hour", async () => {
    rateLimitMock.mockResolvedValueOnce({ allowed: false, retryAfterMs: 600_000 });
    const response = await POST(formRequest({ bytes: png(1024) }));
    expect(response.status).toBe(429);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("needs a multipart body with a file", async () => {
    const json = new Request(URL_, {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    });
    expect((await POST(json)).status).toBe(415);
    expect((await POST(formRequest(null))).status).toBe(400);
  });
});

describe("DELETE /api/profile/avatar", () => {
  it("removes the signed-in user's picture", async () => {
    const response = await DELETE(new Request(URL_, { method: "DELETE" }));
    expect(response.status).toBe(200);
    expect(removeMock).toHaveBeenCalledWith("u_1");
  });

  it("requires a signed-in, same-site request", async () => {
    getSessionMock.mockResolvedValueOnce(null);
    expect((await DELETE(new Request(URL_, { method: "DELETE" }))).status).toBe(401);
    expect(
      (await DELETE(new Request(URL_, { method: "DELETE", headers: { origin: "https://evil.example" } }))).status,
    ).toBe(403);
    expect(removeMock).not.toHaveBeenCalled();
  });
});
