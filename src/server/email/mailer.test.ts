// @vitest-environment node
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const { send, orgRow, getSecret, txOpen } = vi.hoisted(() => ({
  send: vi.fn(),
  orgRow: { current: null as unknown },
  getSecret: vi.fn(),
  txOpen: { value: false },
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));
vi.mock("@/server/db/context", () => ({
  assertNoTx: (label: string) => {
    if (txOpen.value) throw new Error(`${label}: network I/O must not run inside a database transaction`);
  },
  withSystemOrgTx: async (_org: string, fn: (ctx: unknown) => unknown) =>
    fn({ db: { organization: { findUnique: async () => orgRow.current } } }),
}));
vi.mock("@/server/secrets", () => ({ getSecret }));

import { getOrgMailer, getPlatformMailer, resolveOrgMailRouting } from "./mailer";
import { notificationEmail } from "./templates";
import { EmailConfigError, EmailSendError, resendTransport, sinkTransport, transportFor } from "./transport";

const message = { to: "kristine@example.edu", ...notificationEmail({ orgName: "CBC", title: "Hello" }) };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  txOpen.value = false;
});

describe("transports", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "cbc-mail-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("the sink writes the message to disk and sends nothing", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await sinkTransport(dir).send({ from: "a <a@x.org>", ...message });
    expect(result.transport).toBe("sink");
    const files = await readdir(dir);
    expect(files.filter((f) => f.endsWith(".html"))).toHaveLength(1);
    const meta = JSON.parse(await readFile(path.join(dir, files.find((f) => f.endsWith(".json"))!), "utf8"));
    expect(meta).toMatchObject({ to: "kristine@example.edu", subject: "Hello" });
    expect(send).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it("Resend errors are raised, not swallowed", async () => {
    send.mockResolvedValueOnce({ data: null, error: { name: "validation_error", message: "domain not verified" } });
    await expect(resendTransport("re_key").send({ from: "a@x.org", ...message })).rejects.toThrow(EmailSendError);
    send.mockResolvedValueOnce({ data: { id: "em_1" }, error: null });
    await expect(resendTransport("re_key").send({ from: "a@x.org", ...message })).resolves.toEqual({
      id: "em_1",
      transport: "live",
    });
  });

  it("never sends inside a transaction", async () => {
    txOpen.value = true;
    await expect(resendTransport("re_key").send({ from: "a@x.org", ...message })).rejects.toThrow(/transaction/);
    expect(send).not.toHaveBeenCalled();
  });

  it("follows EMAIL_DELIVERY and refuses live delivery without a key", () => {
    expect(transportFor("re_key", { EMAIL_DELIVERY: "off" }).name).toBe("off");
    expect(transportFor(null, {}).name).toBe("sink");
    expect(transportFor("re_key", { RESEND_API_KEY: "re_key" }).name).toBe("live");
    expect(() => transportFor(null, { VERCEL_ENV: "production" })).toThrow(EmailConfigError);
  });
});

describe("mail routing", () => {
  const cbc = (over: Record<string, unknown> = {}) => ({
    name: "Claude Builders Club",
    settings: { platformMailFallback: true },
    integrations: [],
    ...over,
  });

  it("uses the platform sender on behalf of the org while the fallback is on", async () => {
    orgRow.current = cbc();
    const mailer = await getOrgMailer("org1");
    expect(mailer?.kind).toBe("platform-fallback");
    expect(mailer?.from).toBe('"Claude Builders Club via CBC Portal" <no-reply@example.com>');
    expect(getSecret).not.toHaveBeenCalled();
  });

  it("is in-app only with neither a sender nor the fallback", async () => {
    orgRow.current = cbc({ settings: { platformMailFallback: false } });
    expect(await getOrgMailer("org1")).toBeNull();
    expect((await resolveOrgMailRouting("org1")).mode).toBe("none");
  });

  it("uses the org's own verified sender and key when connected", async () => {
    orgRow.current = cbc({
      integrations: [
        {
          id: "int_email",
          status: "CONNECTED",
          config: {
            fromName: "CBC Board",
            fromAddress: "board@claudeneu.com",
            replyTo: "hello@claudeneu.com",
            domainVerifiedAt: "2026-09-01T00:00:00Z",
          },
        },
      ],
    });
    getSecret.mockResolvedValue("re_org_key");
    const mailer = await getOrgMailer("org1");
    expect(mailer).toMatchObject({
      kind: "org",
      from: '"CBC Board" <board@claudeneu.com>',
      replyTo: "hello@claudeneu.com",
    });
    expect(getSecret).toHaveBeenCalledWith({ orgId: "org1", integrationId: "int_email", kind: "API_KEY" });
  });

  it("does not use an unverified or disconnected org sender", async () => {
    orgRow.current = cbc({
      settings: { platformMailFallback: false },
      integrations: [{ id: "i", status: "CONNECTED", config: { fromAddress: "board@claudeneu.com" } }],
    });
    expect(await getOrgMailer("org1")).toBeNull();
  });

  it("falls back when the org sender's key is gone, only if the org opted in", async () => {
    orgRow.current = cbc({
      integrations: [
        {
          id: "i",
          status: "CONNECTED",
          config: { fromAddress: "board@claudeneu.com", domainVerifiedAt: "2026-09-01" },
        },
      ],
    });
    getSecret.mockResolvedValue(null);
    expect((await getOrgMailer("org1"))?.kind).toBe("platform-fallback");
  });

  it("the platform mailer uses EMAIL_FROM", () => {
    vi.stubEnv("EMAIL_FROM", "CBC Portal <no-reply@claudeneu.com>");
    expect(getPlatformMailer().from).toBe("CBC Portal <no-reply@claudeneu.com>");
  });
});
