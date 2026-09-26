// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The guided setup's actions: what they orchestrate on top of the
 * integration service, and the two properties that matter most —
 *
 *   1. a save that succeeds sets the org's data moving (the first sync),
 *      and a save that fails does not;
 *   2. nothing that comes back carries a credential, ever.
 *
 * The integration service itself (secrets, the network tests, the audit
 * rows and the owner alerts) is covered by src/server/integrations and
 * src/server/secrets; here it is a seam.
 */

vi.mock("@/server/db/context", async () =>
  (await import("@/test/fake-context")).fakeContextModule(),
);
vi.mock("@/server/integrations/service", () => ({
  resolveActor: vi.fn(),
  saveSupabase: vi.fn(),
  saveClaude: vi.fn(),
  saveEmailSender: vi.fn(),
  saveGoogleCalendars: vi.fn(),
  sendTestEmail: vi.fn(),
  testProvider: vi.fn(),
  removeProvider: vi.fn(),
  disconnectGoogle: vi.fn(),
}));
vi.mock("@/server/setup/service", () => ({
  startFirstSync: vi.fn(async () => true),
  onProviderConnected: vi.fn(async () => undefined),
}));
vi.mock("@/server/setup/progress", () => ({
  skipStep: vi.fn(async () => undefined),
  unskipStep: vi.fn(async () => undefined),
  setSetupCompleted: vi.fn(async () => undefined),
}));
vi.mock("@/server/setup/summary", () => ({
  loadDataCounts: vi.fn(async () => ({
    checkIns: 1204,
    signups: 312,
    sessions: 14,
    people: 486,
    ballots: 9,
  })),
  syncPending: vi.fn(async () => false),
}));
vi.mock("@/server/sync/status", () => ({ loadSyncStatus: vi.fn(async () => null) }));

const { fake, resetFake } = await import("@/test/fake-context");
const { ForbiddenError, NotFoundError } = await import("@/lib/auth/errors");
const service = await import("@/server/integrations/service");
const setupService = await import("@/server/setup/service");
const progress = await import("@/server/setup/progress");
const actions = await import("./actions");

const SUPABASE_INPUT = {
  projectRef: "abcdefghijklmnopqrst",
  poolerRegion: "us-east-1",
  poolerPrefix: "aws-0",
  roleName: "cbc_suite_reader",
  password: "a-long-random-password",
};

beforeEach(() => {
  vi.clearAllMocks();
  resetFake({ role: "ADMIN" });
  vi.mocked(service.resolveActor).mockResolvedValue({ userId: "actor", role: "ADMIN" });
  vi.mocked(setupService.startFirstSync).mockResolvedValue(true);
});

describe("connecting the website data source", () => {
  it("a successful connection queues the first sync and says so", async () => {
    vi.mocked(service.saveSupabase).mockResolvedValue({ ok: true, message: "Saved." });
    const result = await actions.connectDataSourceAction("org_A", SUPABASE_INPUT);
    expect(result).toMatchObject({ ok: true, synced: true });
    expect(setupService.startFirstSync).toHaveBeenCalledWith("org_A", "actor");
    expect(setupService.onProviderConnected).toHaveBeenCalledWith(
      "org_A",
      "actor",
      "SUPABASE_SOURCE",
    );
  });

  it("a failed connection syncs nothing, and hands back the fix for that failure", async () => {
    vi.mocked(service.saveSupabase).mockResolvedValue({
      ok: false,
      error: "The website database refused the password for the reader role.",
    });
    const result = await actions.connectDataSourceAction("org_A", SUPABASE_INPUT);
    expect(result).toMatchObject({
      ok: false,
      error: "The website database refused the password for the reader role.",
      fix: expect.stringMatching(/ALTER ROLE/),
      field: "password",
    });
    expect(setupService.startFirstSync).not.toHaveBeenCalled();
    expect(setupService.onProviderConnected).not.toHaveBeenCalled();
  });

  it("is honest when there is nothing to sync yet", async () => {
    vi.mocked(service.saveSupabase).mockResolvedValue({ ok: true });
    vi.mocked(setupService.startFirstSync).mockResolvedValue(false);
    const result = await actions.connectDataSourceAction("org_A", SUPABASE_INPUT);
    expect(result).toMatchObject({ ok: true, synced: false });
    expect(result).toMatchObject({ message: expect.stringMatching(/will run shortly/) });
  });

  it("never echoes the password it was handed, in success or in failure", async () => {
    vi.mocked(service.saveSupabase).mockResolvedValue({ ok: true, message: "Saved." });
    const ok = await actions.connectDataSourceAction("org_A", SUPABASE_INPUT);
    vi.mocked(service.saveSupabase).mockResolvedValue({ ok: false, error: "nope" });
    const bad = await actions.connectDataSourceAction("org_A", SUPABASE_INPUT);
    expect(JSON.stringify([ok, bad])).not.toContain("a-long-random-password");
  });
});

describe("connecting the other three", () => {
  it("a Claude key that works is recorded as connected", async () => {
    vi.mocked(service.saveClaude).mockResolvedValue({ ok: true, message: "The key works." });
    const result = await actions.connectClaudeAction("org_A", {
      apiKey: "sk-ant-secret-value",
      model: "claude-opus-5",
      fallbacks: true,
    });
    expect(result).toMatchObject({ ok: true });
    expect(setupService.onProviderConnected).toHaveBeenCalledWith("org_A", "actor", "CLAUDE");
    expect(JSON.stringify(result)).not.toContain("sk-ant-secret-value");
    // Only the data source pulls anything; a key alone syncs nothing.
    expect(setupService.startFirstSync).not.toHaveBeenCalled();
  });

  it("a rejected Claude key comes back with the console instructions", async () => {
    vi.mocked(service.saveClaude).mockResolvedValue({
      ok: false,
      error: "Claude rejected this API key.",
    });
    expect(await actions.connectClaudeAction("org_A", { apiKey: "sk-ant-x" })).toMatchObject({
      ok: false,
      fix: expect.stringMatching(/console\.anthropic\.com/),
      field: "apiKey",
    });
  });

  it("an unverified sending domain is explained as DNS, not as a broken key", async () => {
    vi.mocked(service.saveEmailSender).mockResolvedValue({
      ok: false,
      error: "mail.club.org is pending in Resend. Finish the DNS records, then test again.",
    });
    expect(
      await actions.connectEmailAction("org_A", {
        fromName: "CBC",
        fromAddress: "team@mail.club.org",
        apiKey: "re_secret",
      }),
    ).toMatchObject({ ok: false, fix: expect.stringMatching(/DNS/) });
  });

  it("saving the Google calendars counts as connecting that step", async () => {
    vi.mocked(service.saveGoogleCalendars).mockResolvedValue({ ok: true, message: "Saved." });
    await actions.saveSetupCalendarsAction("org_A", { publicCalendarId: "cal_1" });
    expect(setupService.onProviderConnected).toHaveBeenCalledWith(
      "org_A",
      "actor",
      "GOOGLE_CALENDAR",
    );
  });
});

describe("re-testing a step", () => {
  it("a data source that starts working gets its sync queued in the same click", async () => {
    vi.mocked(service.testProvider).mockResolvedValue({ ok: true, message: "Connected." });
    const result = await actions.testSetupStepAction("org_A", "data");
    expect(result).toMatchObject({ ok: true, synced: true });
    expect(setupService.startFirstSync).toHaveBeenCalledWith("org_A", "actor");
  });

  it("testing anything else queues nothing", async () => {
    vi.mocked(service.testProvider).mockResolvedValue({ ok: true });
    await actions.testSetupStepAction("org_A", "email");
    expect(setupService.startFirstSync).not.toHaveBeenCalled();
  });

  it("a failed re-test never queues a sync", async () => {
    vi.mocked(service.testProvider).mockResolvedValue({ ok: false, error: "still broken" });
    expect(await actions.testSetupStepAction("org_A", "data")).toMatchObject({ ok: false });
    expect(setupService.startFirstSync).not.toHaveBeenCalled();
  });

  it("refuses a step id that is not one of ours", async () => {
    await expect(actions.testSetupStepAction("org_A", "../../admin")).rejects.toThrow();
  });
});

describe("disconnecting", () => {
  it("Google is disconnected (revoked at Google), the rest have their secret removed", async () => {
    vi.mocked(service.disconnectGoogle).mockResolvedValue({ ok: true });
    await actions.disconnectSetupStepAction("org_A", "calendar");
    expect(service.disconnectGoogle).toHaveBeenCalled();
    expect(service.removeProvider).not.toHaveBeenCalled();

    vi.mocked(service.removeProvider).mockResolvedValue({ ok: true });
    await actions.disconnectSetupStepAction("org_A", "claude");
    expect(service.removeProvider).toHaveBeenCalledWith("org_A", expect.anything(), "CLAUDE");
  });

  it("an owner-only refusal comes back as a message, not a crash", async () => {
    vi.mocked(service.removeProvider).mockRejectedValue(new ForbiddenError("Owners only."));
    expect(await actions.disconnectSetupStepAction("org_A", "claude")).toEqual({
      ok: false,
      error: "Owners only.",
    });
  });
});

describe("progress, and who may change it", () => {
  it("an admin may skip, resume and finish", async () => {
    expect(await actions.skipSetupStepAction("org_A", "email")).toMatchObject({ ok: true });
    expect(progress.skipStep).toHaveBeenCalledWith(fake.db, "org_A", "actor", "email");
    expect(await actions.resumeSetupStepAction("org_A", "email")).toMatchObject({ ok: true });
    expect(await actions.finishSetupAction("org_A", true)).toMatchObject({ ok: true });
    expect(progress.setSetupCompleted).toHaveBeenCalledWith(fake.db, "org_A", "actor", true);
  });

  it("a member may not, and is told so rather than shown a crash", async () => {
    resetFake({ role: "MEMBER" });
    expect(await actions.skipSetupStepAction("org_A", "email")).toMatchObject({ ok: false });
    expect(await actions.finishSetupAction("org_A", true)).toMatchObject({ ok: false });
    expect(progress.skipStep).not.toHaveBeenCalled();
    expect(progress.setSetupCompleted).not.toHaveBeenCalled();
  });

  it("a non-member gets nothing at all", async () => {
    vi.mocked(service.resolveActor).mockRejectedValue(new NotFoundError("no"));
    expect(await actions.connectDataSourceAction("org_A", SUPABASE_INPUT)).toEqual({
      ok: false,
      error: "Not found.",
    });
  });
});

describe("the sync poll", () => {
  it("gives an admin the live counts", async () => {
    resetFake({ role: "ADMIN" });
    const progressView = await actions.syncProgressAction("org_A");
    expect(progressView).toMatchObject({ syncing: false, counts: { checkIns: 1204 } });
  });

  it("gives a member nothing: these are integration internals", async () => {
    resetFake({ role: "MEMBER" });
    expect(await actions.syncProgressAction("org_A")).toBeNull();
    resetFake({ role: "TREASURER" });
    expect(await actions.syncProgressAction("org_A")).toBeNull();
  });
});
