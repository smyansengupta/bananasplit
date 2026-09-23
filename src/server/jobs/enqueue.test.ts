import { beforeEach, describe, expect, it, vi } from "vitest";

const { currentTx, scheduleKick } = vi.hoisted(() => ({
  currentTx: vi.fn(),
  scheduleKick: vi.fn(),
}));
vi.mock("@/server/db/context", () => ({ currentTx }));
vi.mock("./kick", () => ({ scheduleKick }));

import { assertIdsOnly, enqueueJob, InvalidJobError, prepareJob, type JobDb } from "./enqueue";

function fakeDb(id: string | null = "job_1") {
  const calls: { sql: string; values: unknown[] }[] = [];
  const db = {
    calls,
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join("?"), values });
      return [{ id }];
    }),
  };
  return db as typeof db & JobDb;
}

beforeEach(() => {
  vi.clearAllMocks();
  currentTx.mockReturnValue(undefined);
});

describe("prepareJob", () => {
  it("prefixes the dedupe key with the kind and validates the payload", () => {
    const job = prepareJob({
      orgId: "org1",
      kind: "notify-email",
      key: "n_1",
      payload: { notificationId: "n_1" },
    });
    expect(job).toMatchObject({
      orgId: "org1",
      kind: "notify-email",
      dedupeKey: "notify-email:n_1",
      payloadJson: '{"notificationId":"n_1"}',
      runAt: null,
      maxAttempts: 8,
      once: false,
    });
  });

  it("enforces org vs platform scope", () => {
    expect(() =>
      prepareJob({ orgId: null, kind: "notify-email", key: "n", payload: { notificationId: "n" } }),
    ).toThrow(InvalidJobError);
    expect(() =>
      prepareJob({ orgId: "org1", kind: "verify-email", key: "u", payload: { userId: "u" } }),
    ).toThrow(InvalidJobError);
  });

  it("rejects bad keys, bad payloads and PII", () => {
    const base = { orgId: "org1", kind: "notify-email" as const, payload: { notificationId: "n" } };
    expect(() => prepareJob({ ...base, key: "" })).toThrow(InvalidJobError);
    expect(() => prepareJob({ ...base, key: "a b" })).toThrow(InvalidJobError);
    expect(() => prepareJob({ ...base, key: "x@y.co" })).toThrow(InvalidJobError);
    expect(() =>
      prepareJob({ ...base, key: "n", payload: { notificationId: "someone@example.edu" } }),
    ).toThrow(InvalidJobError);
    expect(() =>
      // @ts-expect-error unknown kind
      prepareJob({ orgId: "org1", kind: "nope", key: "n", payload: {} }),
    ).toThrow(/unknown job kind/);
  });

  it("assertIdsOnly refuses emails, whitespace and long text anywhere", () => {
    expect(() => assertIdsOnly({ a: ["ok", 1, true] })).not.toThrow();
    expect(() => assertIdsOnly({ a: { b: "x@y.io" } })).toThrow(/ids only/);
    expect(() => assertIdsOnly({ a: "two words" })).toThrow();
    expect(() => assertIdsOnly({ a: "x".repeat(201) })).toThrow();
  });
});

describe("enqueueJob", () => {
  it("calls app.enqueue_job with the caller's client", async () => {
    const db = fakeDb();
    const runAt = new Date("2026-10-01T13:00:00.000Z");
    const id = await enqueueJob(db, {
      orgId: "org1",
      kind: "site-rebuild",
      key: "org1",
      payload: {},
      runAt,
      once: true,
    });
    expect(id).toBe("job_1");
    expect(db.calls[0]!.sql).toContain("app.enqueue_job");
    expect(db.calls[0]!.values).toEqual([
      "org1",
      "site-rebuild",
      "site-rebuild:org1",
      "{}",
      "2026-10-01T13:00:00.000Z",
      8,
      true,
    ]);
  });

  it("schedules the kick after commit inside a transaction, never before", async () => {
    const queue: Array<() => void> = [];
    currentTx.mockReturnValue({ afterCommit: (fn: () => void) => queue.push(fn) });
    await enqueueJob(fakeDb(), {
      orgId: "org1",
      kind: "notify-email",
      key: "n_1",
      payload: { notificationId: "n_1" },
    });
    expect(scheduleKick).not.toHaveBeenCalled();
    queue.forEach((fn) => fn());
    expect(scheduleKick).toHaveBeenCalledWith("notify-email", { due: true });
  });

  it("kicks at once outside a wrapper, marks future jobs not due, and skips refused once-keys", async () => {
    await enqueueJob(fakeDb(), {
      orgId: "org1",
      kind: "gcal",
      key: "e1",
      payload: { eventId: "e1" },
      runAt: new Date(Date.now() + 60_000),
    });
    expect(scheduleKick).toHaveBeenCalledWith("gcal", { due: false });

    scheduleKick.mockClear();
    const id = await enqueueJob(fakeDb(null), {
      orgId: null,
      kind: "maintenance",
      key: "2026-09-22",
      payload: {},
      once: true,
    });
    expect(id).toBeNull();
    expect(scheduleKick).not.toHaveBeenCalled();
  });
});
