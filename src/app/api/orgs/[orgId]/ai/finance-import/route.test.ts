// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  session: vi.fn(),
  context: vi.fn(),
  rate: vi.fn(),
  creds: vi.fn(),
  sheet: vi.fn(),
  doc: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getSession: m.session }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: m.rate,
  rateLimitKey: (...parts: string[]) => parts.join(":"),
  retryAfterText: () => "in a minute",
}));
vi.mock("@/server/ai/connections", () => ({ resolveAiCredentials: m.creds }));
vi.mock("@/server/ai/finance-import", () => ({ readFinanceSheet: m.sheet, readFinanceDocument: m.doc }));
vi.mock("@/server/ai/route-context", () => ({ loadFinanceImportContext: m.context, auditAiRead: m.audit }));

import { NotFoundError } from "@/lib/auth/errors";
import { AiImportError } from "@/server/ai/generate";

import { POST } from "./route";

const params = { params: Promise.resolve({ orgId: "org_1" }) };
const headers = { origin: "http://localhost", "sec-fetch-site": "same-origin" };
const postJson = (body: unknown, extra: Record<string, string> = {}) =>
  POST(
    new Request("http://localhost/api/orgs/org_1/ai/finance-import", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers, ...extra },
      body: JSON.stringify(body),
    }),
    params,
  );
const postFile = (bytes: Uint8Array, name: string) => {
  const form = new FormData();
  form.append("file", new File([bytes as BlobPart], name));
  return POST(new Request("http://localhost/api/orgs/org_1/ai/finance-import", { method: "POST", headers, body: form }), params);
};

const sample = {
  width: 2,
  rows: [
    { i: 0, cells: ["Date", "Amount"] },
    { i: 1, cells: ["9/5/2026", "12"] },
  ],
  values: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue({ user: { id: "u1" } });
  m.context.mockResolvedValue({ userId: "u1", canManageFinance: true, timezone: "UTC", today: "2026-10-01", categories: ["Food"] });
  m.rate.mockResolvedValue({ allowed: true });
  m.creds.mockResolvedValue({ id: "claude", protocol: "anthropic", apiKey: "k", model: "claude-x", label: "Claude X" });
  m.sheet.mockResolvedValue({ result: { mapping: null, labels: [], notes: [] }, model: "claude-x", label: "Claude X" });
  m.doc.mockResolvedValue({ result: { kind: "transactions", rows: [{ key: "d0" }], budget: [], notes: [] }, model: "claude-x", label: "Claude X" });
});

describe("POST /api/orgs/{orgId}/ai/finance-import", () => {
  it("maps a sheet sample, audits sizes only, and says who read it", async () => {
    const res = await postJson({ mode: "sheet", sample });
    expect(res.status).toBe(200);
    expect((await res.json()).readBy).toBe("Claude X");
    expect(m.sheet).toHaveBeenCalledWith(expect.objectContaining({ today: "2026-10-01", categories: ["Food"] }));
    expect(m.audit).toHaveBeenCalledWith("org_1", "ai.finance_import_read", expect.objectContaining({ mode: "sheet", rows: 2 }));
    expect(JSON.stringify(m.audit.mock.calls)).not.toContain("9/5/2026");
  });

  it("reads pasted text and uploaded PDFs and pictures, checked by their bytes", async () => {
    expect((await postJson({ mode: "text", text: "9/5 pizza 12" })).status).toBe(200);
    expect(m.doc).toHaveBeenLastCalledWith(expect.objectContaining({ text: "9/5 pizza 12" }));

    const pdf = new TextEncoder().encode("%PDF-1.7 tiny");
    expect((await postFile(pdf, "statement.pdf")).status).toBe(200);
    expect(m.doc).toHaveBeenLastCalledWith(
      expect.objectContaining({ document: expect.objectContaining({ mediaType: "application/pdf", fileName: "statement.pdf" }) }),
    );

    const fake = new TextEncoder().encode("Date,Amount\n9/5,12");
    const refused = await postFile(fake, "renamed.pdf");
    expect(refused.status).toBe(415);
  });

  it("is for owners and treasurers, same-site, signed in, members only, and rate-limited", async () => {
    m.session.mockResolvedValueOnce(null);
    expect((await postJson({ mode: "sheet", sample })).status).toBe(401);

    m.context.mockRejectedValueOnce(new NotFoundError());
    expect((await postJson({ mode: "sheet", sample })).status).toBe(404);

    m.context.mockResolvedValueOnce({ userId: "u1", canManageFinance: false, timezone: "UTC", today: "2026-10-01", categories: [] });
    expect((await postJson({ mode: "sheet", sample })).status).toBe(403);

    expect((await postJson({ mode: "sheet", sample }, { "sec-fetch-site": "cross-site", origin: "https://evil.example" })).status).toBe(403);

    expect((await postJson({ mode: "text", text: "  " })).status).toBe(400);
    expect((await postJson({ mode: "sheet", sample: { ...sample, width: 999 } })).status).toBe(400);

    m.rate.mockResolvedValueOnce({ allowed: false });
    expect((await postJson({ mode: "sheet", sample })).status).toBe(429);
    expect(m.sheet).not.toHaveBeenCalled();
  });

  it("says when no model is connected, and passes model errors through", async () => {
    m.creds.mockResolvedValueOnce(null);
    const none = await postJson({ mode: "sheet", sample });
    expect(none.status).toBe(409);
    expect((await none.json()).code).toBe("no-connection");

    m.sheet.mockRejectedValueOnce(new AiImportError("Claude is busy right now (rate limit). Try again in a minute.", 429));
    const busy = await postJson({ mode: "sheet", sample });
    expect(busy.status).toBe(429);
    expect((await busy.json()).error).toMatch(/busy/);
  });
});
