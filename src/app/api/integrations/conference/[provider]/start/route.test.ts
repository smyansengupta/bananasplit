// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ session: vi.fn(), orgTx: vi.fn(), rate: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getSession: m.session }));
vi.mock("@/server/db/context", () => ({ withOrgTx: m.orgTx, assertNoTx: () => undefined }));
// checkRateLimit is stubbed, but rateLimitKey is deliberately NOT: building
// the bucket key is where this route once threw a 500 for every single
// Connect, because the scope carried a colon and an uppercase provider name.
vi.mock("@/lib/rate-limit", async () => ({
  ...(await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit")),
  checkRateLimit: m.rate,
}));

import { POST } from "./route";

const ENV = {
  AUTH_SECRET: "test-secret",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  GOOGLE_MEET_CLIENT_ID: "meet-id",
  GOOGLE_MEET_CLIENT_SECRET: "meet-secret",
  ZOOM_CLIENT_ID: "zoom-id",
  ZOOM_CLIENT_SECRET: "zoom-secret",
};

function post(provider: string, orgId = "org_1", headers: Record<string, string> = {}) {
  const body = new URLSearchParams({ orgId });
  return POST(
    new Request(`http://localhost:3000/api/integrations/conference/${provider}/start`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "http://localhost:3000",
        "sec-fetch-site": "same-origin",
        ...headers,
      },
      body: body.toString(),
    }) as never,
    { params: Promise.resolve({ provider }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(process.env, ENV);
  m.session.mockResolvedValue({ user: { id: "u1" } });
  m.orgTx.mockImplementation(async (_orgId: string, fn: (c: unknown) => unknown) =>
    fn({
      role: "ADMIN",
      db: { organization: { findUniqueOrThrow: async () => ({ slug: "cbc" }) } },
    }),
  );
  m.rate.mockResolvedValue({ allowed: true });
});

describe("starting a provider connection", () => {
  it("sends an admin to the provider with PKCE, the scopes and a signed state", async () => {
    const res = await post("google-meet");

    expect(res.status).toBe(303);
    const to = new URL(res.headers.get("location")!);
    expect(to.origin + to.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(to.searchParams.get("client_id")).toBe("meet-id");
    expect(to.searchParams.get("code_challenge_method")).toBe("S256");
    expect(to.searchParams.get("code_challenge")).toBeTruthy();
    expect(to.searchParams.get("access_type")).toBe("offline");
    expect(to.searchParams.get("scope")).toContain("meetings.space.created");
    expect(to.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/integrations/conference/google-meet/callback",
    );
    expect(to.searchParams.get("state")).toBeTruthy();
  });

  it("builds a rate-limit bucket the limiter will accept", async () => {
    // The regression guard: rateLimitKey throws on a scope that is not a
    // short lowercase name, and this route used to pass it
    // "conference-connect:GOOGLE_MEET".
    await expect(post("google-meet")).resolves.toBeDefined();
    expect(m.rate).toHaveBeenCalledTimes(1);
    const [key] = m.rate.mock.calls[0]!;
    expect(String(key).split(":")[0]).toBe("conference-connect");
    // The provider and the org are hashed parts, never in the clear.
    expect(String(key)).not.toContain("GOOGLE_MEET");
    expect(String(key)).not.toContain("org_1");
  });

  it("counts each provider in its own bucket", async () => {
    await post("google-meet");
    await post("zoom");
    const [first] = m.rate.mock.calls[0]!;
    const [second] = m.rate.mock.calls[1]!;
    expect(first).not.toBe(second);
  });

  it("sets the nonce cookie httpOnly and scoped to that provider's routes", async () => {
    const res = await post("zoom");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("conf_oauth_zoom=");
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie).toContain("Path=/api/integrations/conference/zoom");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
  });

  it("turns away a post from another site", async () => {
    const res = await post("zoom", "org_1", {
      origin: "https://evil.example",
      host: "localhost:3000",
    });
    expect(res.status).toBe(403);
    expect(m.rate).not.toHaveBeenCalled();
  });

  it("turns away a provider that is not one of ours", async () => {
    expect((await post("google-calendar")).status).toBe(404);
    expect((await post("../../etc/passwd")).status).toBe(404);
  });

  it("turns away a member who is not an owner or admin", async () => {
    m.orgTx.mockImplementation(async (_orgId: string, fn: (c: unknown) => unknown) =>
      fn({
        role: "MEMBER",
        db: { organization: { findUniqueOrThrow: async () => ({ slug: "cbc" }) } },
      }),
    );
    const res = await post("zoom");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("owners and admins") });
  });

  it("sends a signed-out visitor to sign in", async () => {
    m.session.mockResolvedValue(null);
    const res = await post("zoom");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/sign-in");
  });

  it("explains itself instead of failing when the platform has no client", async () => {
    delete process.env.ZOOM_CLIENT_ID;
    const res = await post("zoom");
    expect(res.status).toBe(303);
    const to = new URL(res.headers.get("location")!);
    expect(to.pathname).toBe("/app/cbc/meetings");
    expect(to.searchParams.get("conference")).toBe("not_configured");
  });

  it("sends a rate-limited admin back with a reason, not to consent", async () => {
    m.rate.mockResolvedValue({ allowed: false });
    const res = await post("zoom");
    const to = new URL(res.headers.get("location")!);
    expect(to.pathname).toBe("/app/cbc/meetings");
    expect(to.searchParams.get("conference")).toBe("rate_limited");
  });
});
