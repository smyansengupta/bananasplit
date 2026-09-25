import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
  type MockInstance,
} from "vitest";
import { z } from "zod";

const { serviceQuery, emailDelivery, handlers } = vi.hoisted(() => ({
  serviceQuery: vi.fn(),
  emailDelivery: vi.fn(() => "sink"),
  handlers: {} as Record<string, Mock<(run: unknown) => Promise<unknown>>>,
}));

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/server/db/clients", () => ({
  serviceDb: { $queryRaw: serviceQuery },
  appDb: {},
  authDb: {},
}));
vi.mock("@/server/email/config", () => ({ emailDelivery }));

// A small registry with controllable handlers.
vi.mock("./registry", () => {
  const defs: Record<string, Record<string, unknown>> = {
    fast: {
      payload: z.object({ id: z.string() }),
      scope: "org",
      maxRuntimeMs: 1_000,
      leaseSeconds: 45,
      tier: "fast",
      afterEligible: true,
    },
    // Like the real email kinds: 20s maxRuntime, 60s lease.
    mail: {
      payload: z.object({ id: z.string() }),
      scope: "org",
      maxRuntimeMs: 20_000,
      leaseSeconds: 60,
      tier: "fast",
      afterEligible: true,
      sendsEmail: true,
    },
    scheduled: {
      payload: z.object({}),
      scope: "org",
      maxRuntimeMs: 1_000,
      leaseSeconds: 45,
      tier: "fast",
      afterEligible: false,
    },
    heavy: {
      payload: z.object({}),
      scope: "org",
      maxRuntimeMs: 100_000,
      leaseSeconds: 330,
      tier: "heavy",
      afterEligible: false,
    },
    slow: {
      payload: z.object({}),
      scope: "org",
      maxRuntimeMs: 50,
      leaseSeconds: 45,
      tier: "fast",
      afterEligible: true,
    },
  };
  for (const name of Object.keys(defs)) {
    defs[name]!.handler = async () => (run: unknown) => handlers[name]!(run);
  }
  return {
    JOB_KINDS: defs,
    isJobKind: (k: string) => k in defs,
    jobKind: (k: string) => defs[k],
    implementedKinds: () => Object.keys(defs),
    leaseMap: (kinds: string[]) => Object.fromEntries(kinds.map((k) => [k, defs[k]!.leaseSeconds])),
  };
});

import { isBackgroundWork } from "@/server/cache/invalidate";

import { drainJobs, jobStore, runnableKinds } from "./drain";
import { PermanentJobError } from "./types";

function row(kind: string, payload: unknown = { id: "x1" }, extra: Record<string, unknown> = {}) {
  return {
    id: `job_${kind}_${Math.random().toString(36).slice(2, 7)}`,
    organizationId: "org1",
    kind,
    payload,
    dedupeKey: `${kind}:x1`,
    runAt: new Date(),
    status: "RUNNING",
    attempts: 1,
    maxAttempts: 8,
    lockedUntil: new Date(Date.now() + 60_000),
    lockToken: "tok",
    rerunRequested: false,
    ...extra,
  };
}

let queue: ReturnType<typeof row>[] = [];
let claim: MockInstance<typeof jobStore.claim>;
let finish: MockInstance<typeof jobStore.finish>;

beforeEach(() => {
  queue = [];
  for (const k of ["fast", "mail", "scheduled", "heavy", "slow"])
    handlers[k] = vi.fn(async () => undefined);
  claim = vi.spyOn(jobStore, "claim").mockImplementation(async (kinds, limit) => {
    const picked = queue
      .filter((r) => (kinds as readonly string[]).includes(r.kind))
      .slice(0, limit);
    queue = queue.filter((r) => !picked.includes(r));
    return picked;
  });
  finish = vi.spyOn(jobStore, "finish").mockResolvedValue(true);
  emailDelivery.mockReturnValue("sink");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("drainJobs", () => {
  it("claims, runs outside the claim and finishes with a compare-and-set", async () => {
    queue = [row("fast"), row("fast")];
    const summary = await drainJobs();
    expect(summary).toMatchObject({ claimed: 2, done: 2, lost: 0 });
    expect(handlers.fast).toHaveBeenCalledTimes(2);
    expect(finish).toHaveBeenCalledWith(expect.stringMatching(/^job_fast/), "tok", {
      status: "DONE",
    });
  });

  it("maps a throw to RETRY with a sanitized error, and PermanentJobError to DEAD", async () => {
    handlers.fast = vi.fn(async () => {
      throw new Error("Resend refused mail for jackson@example.edu with key re_12345678abcdef");
    });
    handlers.mail = vi.fn(async () => {
      throw new PermanentJobError("row is gone");
    });
    queue = [row("fast"), row("mail")];
    const summary = await drainJobs();
    expect(summary).toMatchObject({ retried: 1, dead: 1 });
    const retry = finish.mock.calls.find((c) => c[2].status === "RETRY");
    const error = (retry![2] as { error: string }).error;
    expect(error).not.toContain("jackson@example.edu");
    expect(error).not.toContain("re_12345678abcdef");
  });

  it("dead-letters an invalid payload without running the handler", async () => {
    queue = [row("fast", { nope: true })];
    await drainJobs();
    expect(handlers.fast).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith(expect.any(String), "tok", {
      status: "DEAD",
      error: "invalid payload",
    });
  });

  it("stops waiting at maxRuntime and retries", async () => {
    handlers.slow = vi.fn(() => new Promise(() => undefined));
    queue = [row("slow", {})];
    const summary = await drainJobs();
    expect(summary.retried).toBe(1);
    const call = finish.mock.calls[0]!;
    expect((call[2] as { error: string }).error).toMatch(/maxRuntime/);
  });

  it("counts a lost lease and discards the result", async () => {
    finish.mockResolvedValue(false);
    queue = [row("fast")];
    const summary = await drainJobs();
    expect(summary).toMatchObject({ claimed: 1, done: 0, lost: 1 });
  });

  it("runs handlers as background work, so invalidate() uses revalidateTag", async () => {
    let background: boolean | undefined;
    handlers.fast = vi.fn(async () => {
      background = isBackgroundWork();
    });
    queue = [row("fast")];
    await drainJobs();
    expect(background).toBe(true);
  });

  it("a user request's after() drain takes only after()-eligible kinds", async () => {
    queue = [row("scheduled", {}), row("heavy", {}), row("fast")];
    const summary = await drainJobs({ fast: true });
    expect(summary.claimed).toBe(1);
    expect(handlers.fast).toHaveBeenCalled();
    expect(handlers.heavy).not.toHaveBeenCalled();
    expect(handlers.scheduled).not.toHaveBeenCalled();
  });

  it("claims at most one heavy job, and only when the budget covers its maxRuntime", async () => {
    queue = [row("heavy", {}), row("heavy", {})];
    const short = await drainJobs({ budgetMs: 30_000 });
    expect(short.claimed).toBe(0);
    const long = await drainJobs({ budgetMs: 270_000 });
    expect(long.claimed).toBe(1);
    expect(claim).toHaveBeenCalledWith(["heavy"], 1);
  });

  it("the default budget covers several rounds of 20s email jobs (a user request after() drain)", async () => {
    queue = [row("mail"), row("mail"), row("mail"), row("mail"), row("mail")];
    const summary = await drainJobs({ fast: true, limit: 5 });
    expect(summary).toMatchObject({ claimed: 5, done: 5 });
  });

  it("holds email kinds while EMAIL_DELIVERY=off", async () => {
    emailDelivery.mockReturnValue("off");
    expect(runnableKinds({})).not.toContain("mail");
    queue = [row("mail"), row("fast")];
    const summary = await drainJobs();
    expect(summary.kinds).toEqual({ fast: 1 });
  });

  it("refuses on a preview whose database is not fixture-only, and runs once it is", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    serviceQuery.mockResolvedValueOnce([{ v: null }]);
    queue = [row("fast")];
    const refused = await drainJobs();
    expect(refused.refused).toMatch(/fixture_only/);
    expect(handlers.fast).not.toHaveBeenCalled();
  });
});
