import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
const track = vi.fn();
const rateLimit = vi.fn();
const save = vi.fn();
const session = vi.fn();
const redirect = vi.fn((url: string) => {
  throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { url });
});

vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("@/server/demo/requests", () => ({
  saveDemoRequest: (...args: unknown[]) => save(...args),
}));
vi.mock("@/lib/auth/session", () => ({ getSession: () => session() }));

vi.mock("@/server/email/mailer", () => ({ getPlatformMailer: () => ({ send }) }));
vi.mock("@/lib/analytics/server", () => ({ trackServer: (...args: unknown[]) => track(...args) }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => rateLimit(...args),
  rateLimitKey: (...parts: string[]) => parts.join(":"),
}));
vi.mock("@/lib/request-ip", () => ({ getClientIp: async () => "203.0.113.7" }));

const { requestDemoAction } = await import("./actions");

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const VALID = {
  name: "Alex Rivera",
  email: "Alex@Orbit.dev",
  organization: "Orbit Labs",
  size: "11–50",
  message: "Show us events and the budget.",
};

describe("requestDemoAction", () => {
  beforeEach(() => {
    vi.stubEnv("DEMO_REQUEST_INBOX", "sales@bananasplit.test");
    rateLimit.mockResolvedValue({ allowed: true });
    send.mockResolvedValue({ id: "m1", transport: "sink" });
    save.mockResolvedValue(undefined);
    session.mockResolvedValue(null);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("emails and saves the request, then sends them to create their organization", async () => {
    await expect(requestDemoAction({}, form(VALID))).rejects.toMatchObject({
      url: "/sign-up?callbackUrl=%2Fonboarding%2Forganization",
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "alex@orbit.dev",
        organization: "Orbit Labs",
        teamSize: "11–50",
        emailedAt: expect.any(Date),
      }),
    );
    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0]![0];
    expect(message.to).toBe("sales@bananasplit.test");
    expect(message.subject).toBe("Demo request: Orbit Labs (11–50)");
    expect(message.text).toContain("Work email: alex@orbit.dev");
    expect(track).toHaveBeenCalledWith("Demo Requested", { size: "11–50" });
  });

  it("refuses an invalid email or a missing team size, and sends nothing", async () => {
    const bad = await requestDemoAction({}, form({ ...VALID, email: "nope" }));
    expect(bad.error).toBe("Enter a valid work email");
    expect(bad.values).toMatchObject({ name: "Alex Rivera", email: "nope" });
    expect((await requestDemoAction({}, form({ ...VALID, size: "" }))).error).toBe(
      "Pick your team size",
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("emails the default inbox when none is set, and goes straight to setup when signed in", async () => {
    vi.stubEnv("DEMO_REQUEST_INBOX", "");
    session.mockResolvedValue({ user: { id: "u1" } });
    await expect(requestDemoAction({}, form(VALID))).rejects.toMatchObject({
      url: "/onboarding/organization",
    });
    expect(send.mock.calls[0]![0].to).toBe("jack.lam251@gmail.com");
  });

  it("still saves the request when the email fails, and moves on", async () => {
    send.mockRejectedValue(new Error("network"));
    await expect(requestDemoAction({}, form(VALID))).rejects.toMatchObject({
      url: expect.any(String),
    });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ emailedAt: null }));
  });

  it("stops a flood from one network", async () => {
    rateLimit.mockResolvedValue({ allowed: false, retryAfterMs: 60_000 });
    expect((await requestDemoAction({}, form(VALID))).error).toMatch(/Too many requests/);
    expect(send).not.toHaveBeenCalled();
  });

  it("lets a bot that fills the hidden field through, sending and saving nothing", async () => {
    await expect(
      requestDemoAction({}, form({ ...VALID, website: "https://spam.example" })),
    ).rejects.toMatchObject({ url: "/sign-up?callbackUrl=%2Fonboarding%2Forganization" });
    expect(send).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("past the per-address or site-wide cap, still saves the request and moves on, just no email", async () => {
    for (const capped of ["demo-email", "demo-all"]) {
      vi.clearAllMocks();
      rateLimit.mockImplementation(async (key: string) => ({ allowed: !key.startsWith(capped) }));
      await expect(requestDemoAction({}, form(VALID))).rejects.toMatchObject({
        url: "/sign-up?callbackUrl=%2Fonboarding%2Forganization",
      });
      expect(send).not.toHaveBeenCalled();
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ emailedAt: null }));
    }
  });

  it("tells the person only when both the email and the save fail", async () => {
    send.mockRejectedValue(new Error("network"));
    save.mockRejectedValue(new Error("database"));
    expect((await requestDemoAction({}, form(VALID))).error).toMatch(/couldn't send/);
    expect(track).not.toHaveBeenCalled();
  });
});
