import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
const track = vi.fn();
const rateLimit = vi.fn();

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
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("emails the request to the inbox and records the event with the team size only", async () => {
    expect(await requestDemoAction({}, form(VALID))).toEqual({ sent: true });
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

  it("says so instead of pretending to send when no inbox is set", async () => {
    vi.stubEnv("DEMO_REQUEST_INBOX", "");
    expect((await requestDemoAction({}, form(VALID))).error).toMatch(/aren't switched on yet/);
    expect(send).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });

  it("stops a flood from one network", async () => {
    rateLimit.mockResolvedValue({ allowed: false, retryAfterMs: 60_000 });
    expect((await requestDemoAction({}, form(VALID))).error).toMatch(/Too many requests/);
    expect(send).not.toHaveBeenCalled();
  });

  it("tells the person when sending fails", async () => {
    send.mockRejectedValue(new Error("network"));
    expect((await requestDemoAction({}, form(VALID))).error).toMatch(/couldn't send/);
    expect(track).not.toHaveBeenCalled();
  });
});
