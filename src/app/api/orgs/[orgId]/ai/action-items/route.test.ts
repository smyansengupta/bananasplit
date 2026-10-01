// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  session: vi.fn(),
  context: vi.fn(),
  rate: vi.fn(),
  creds: vi.fn(),
  read: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getSession: m.session }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: m.rate,
  rateLimitKey: (...parts: string[]) => parts.join(":"),
  retryAfterText: () => "in a minute",
}));
vi.mock("@/server/ai/connections", () => ({ resolveAiCredentials: m.creds }));
vi.mock("@/server/ai/imports", () => ({ readActionItems: m.read }));
vi.mock("@/server/ai/route-context", () => ({ loadImportContext: m.context, auditAiRead: m.audit }));

import { NotFoundError } from "@/lib/auth/errors";
import { AiImportError } from "@/server/ai/generate";

import { POST } from "./route";

const params = { params: Promise.resolve({ orgId: "org_1" }) };
const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request("http://localhost/api/orgs/org_1/ai/action-items", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: "http://localhost", "sec-fetch-site": "same-origin", ...headers },
      body: JSON.stringify(body),
    }),
    params,
  );

const ctx = {
  userId: "u1",
  canCreateEvents: false,
  timezone: "America/New_York",
  today: "2026-10-01",
  rules: { requireOwner: false, requireDueDate: false },
  members: [{ key: "m1", userId: "u1", name: "Riley Chen", title: null }],
};

beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue({ user: { id: "u1" } });
  m.context.mockResolvedValue(ctx);
  m.rate.mockResolvedValue({ allowed: true });
  m.creds.mockResolvedValue({ id: "claude", protocol: "anthropic", apiKey: "k", model: "claude-x", label: "Claude X" });
  m.read.mockResolvedValue({ items: [{ key: "i1", title: "Book the room" }], notes: [], usage: null, model: "claude-x", label: "Claude X" });
});

describe("POST /api/orgs/{orgId}/ai/action-items", () => {
  it("proposes items, says who read them, and audits without the text", async () => {
    const res = await post({ text: "- Riley books the room" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.readBy).toBe("Claude X");
    expect(body.members).toEqual([{ id: "u1", name: "Riley Chen", title: null }]);
    expect(m.audit).toHaveBeenCalledWith("org_1", "ai.action_items_read", {
      connection: "claude",
      model: "claude-x",
      characters: "- Riley books the room".length,
      items: 1,
    });
    expect(JSON.stringify(m.audit.mock.calls)).not.toContain("books the room");
  });

  it("refuses strangers, cross-site posts, empty text and over-eager importers", async () => {
    m.session.mockResolvedValueOnce(null);
    expect((await post({ text: "x" })).status).toBe(401);

    m.context.mockRejectedValueOnce(new NotFoundError());
    expect((await post({ text: "x" })).status).toBe(404);

    expect((await post({ text: "x" }, { "sec-fetch-site": "cross-site", origin: "https://evil.example" })).status).toBe(403);

    expect((await post({ text: "   " })).status).toBe(400);

    m.rate.mockResolvedValueOnce({ allowed: false });
    expect((await post({ text: "x" })).status).toBe(429);
    expect(m.read).not.toHaveBeenCalled();
  });

  it("says when no model is connected, and passes model errors through", async () => {
    m.creds.mockResolvedValueOnce(null);
    const none = await post({ text: "x" });
    expect(none.status).toBe(409);
    expect((await none.json()).code).toBe("no-connection");

    m.read.mockRejectedValueOnce(new AiImportError("Claude is busy right now (rate limit). Try again in a minute.", 429));
    const busy = await post({ text: "x" });
    expect(busy.status).toBe(429);
    expect((await busy.json()).error).toMatch(/busy/);
  });
});
