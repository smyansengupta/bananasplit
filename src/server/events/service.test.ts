import { beforeEach, describe, expect, it, vi } from "vitest";

const { invalidate, enqueueJob, writeOrgAuditLog } = vi.hoisted(() => ({
  invalidate: vi.fn(),
  enqueueJob: vi.fn(async (_db: unknown, _input: { kind: string; runAt?: Date }) => "job_1"),
  writeOrgAuditLog: vi.fn(async (_db: unknown, _entry: unknown) => "audit_1"),
}));
vi.mock("@/server/cache/invalidate", () => ({ invalidate }));
vi.mock("@/server/jobs/enqueue", () => ({ enqueueJob }));
vi.mock("@/server/audit", () => ({ writeOrgAuditLog }));

import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { tags } from "@/server/cache/tags";

import {
  createEvent,
  deleteEvent,
  EventValidationError,
  publicEventsWhere,
  updateEvent,
  type EventServiceContext,
} from "./service";

const ORG = "org1";

function makeCtx(opts: {
  role?: "OWNER" | "ADMIN" | "MEMBER" | null;
  kind?: EventServiceContext["kind"];
  integrations?: { provider: string; config?: unknown }[];
  existing?: Record<string, unknown> | null;
  hostIsMember?: boolean;
}) {
  const saved: Record<string, unknown>[] = [];
  const db = {
    membership: { count: vi.fn(async () => (opts.hostIsMember === false ? 0 : 1)) },
    orgIntegration: { findMany: vi.fn(async () => opts.integrations ?? []) },
    event: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        saved.push(data);
        return { id: "evt_1", googleEventId: null, deletedAt: null, ...data };
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        saved.push(data);
        const base = opts.existing ?? {};
        const merged: Record<string, unknown> = { ...base };
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === "object" && "increment" in (v as object)) {
            merged[k] = Number(base[k] ?? 0) + (v as { increment: number }).increment;
          } else merged[k] = v;
        }
        return merged;
      }),
      findFirst: vi.fn(async () => opts.existing ?? null),
    },
  };
  const ctx = {
    db,
    organizationId: ORG,
    userId: "u_admin",
    role: opts.role === undefined ? "ADMIN" : opts.role,
    kind: opts.kind ?? "action",
  } as unknown as EventServiceContext;
  return { ctx, db, saved };
}

const base = {
  title: "Intro to Claude Code",
  startsAt: "2026-10-01T22:00:00.000Z",
  endsAt: "2026-10-01T23:30:00.000Z",
};

const existing = {
  id: "evt_1",
  organizationId: ORG,
  title: "Old",
  startsAt: new Date("2026-10-01T22:00:00.000Z"),
  endsAt: new Date("2026-10-01T23:00:00.000Z"),
  conferenceProvider: "NONE",
  conferenceUrl: null,
  visibility: "INTERNAL",
  kind: "WORKSHOP",
  hostUserId: null,
  googleEventId: null,
  syncVersion: 3,
  deletedAt: null,
};

beforeEach(() => vi.clearAllMocks());

describe("event service", () => {
  it("is ADMIN+ for user contexts and open to the service path", async () => {
    await expect(createEvent(makeCtx({ role: "MEMBER" }).ctx, base)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createEvent(makeCtx({ role: null, kind: "system" }).ctx, base)).resolves.toBeTruthy();
  });

  it("creates INTERNAL by default, bumps syncVersion and invalidates reports only", async () => {
    const { ctx, saved } = makeCtx({});
    const { tags: touched } = await createEvent(ctx, base);
    expect(saved[0]).toMatchObject({
      organizationId: ORG,
      createdById: "u_admin",
      visibility: "INTERNAL",
      kind: "OTHER",
      syncVersion: 1,
      googleSyncState: "NOT_APPLICABLE",
    });
    expect(saved[0]!.suiteEditedAt).toBeInstanceOf(Date);
    expect(touched).toEqual([tags.reports(ORG)]);
    expect(invalidate).toHaveBeenCalledWith([tags.reports(ORG)]);
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(writeOrgAuditLog).toHaveBeenCalledWith(ctx.db, expect.objectContaining({ action: "event.created" }));
  });

  it("a PUBLIC event with Google and a build hook enqueues gcal and a delayed site rebuild", async () => {
    const { ctx, saved } = makeCtx({
      integrations: [{ provider: "GOOGLE_CALENDAR", config: {} }, { provider: "NETLIFY_BUILD_HOOK" }],
    });
    const { tags: touched } = await createEvent(ctx, { ...base, visibility: "PUBLIC", kind: "WORKSHOP" });
    expect(saved[0]).toMatchObject({ googleSyncState: "PENDING" });
    expect(enqueueJob).toHaveBeenCalledWith(ctx.db, expect.objectContaining({ kind: "gcal", key: "evt_1" }));
    const rebuild = enqueueJob.mock.calls.find((c) => c[1].kind === "site-rebuild");
    expect(rebuild).toBeTruthy();
    expect(rebuild![1].runAt!.getTime()).toBeGreaterThan(Date.now() + 50_000);
    expect(touched).toEqual([tags.reports(ORG), tags.publicEvents(ORG)]);
  });

  it("an INTERNAL event is mirrored only when an internal calendar is configured", async () => {
    const plain = makeCtx({ integrations: [{ provider: "GOOGLE_CALENDAR", config: {} }] });
    await createEvent(plain.ctx, base);
    expect(enqueueJob).not.toHaveBeenCalled();
    const internal = makeCtx({
      integrations: [{ provider: "GOOGLE_CALENDAR", config: { internalCalendarId: "cal_int" } }],
    });
    await createEvent(internal.ctx, base);
    expect(enqueueJob).toHaveBeenCalledWith(internal.ctx.db, expect.objectContaining({ kind: "gcal" }));
  });

  it("validates times, links, the RSVP URL and the host", async () => {
    const { ctx } = makeCtx({});
    await expect(createEvent(ctx, { ...base, endsAt: "2026-10-01T21:00:00.000Z" })).rejects.toBeInstanceOf(
      EventValidationError,
    );
    await expect(createEvent(ctx, { ...base, rsvpUrl: "javascript:alert(1)" })).rejects.toBeInstanceOf(
      EventValidationError,
    );
    await expect(createEvent(ctx, { ...base, conferenceProvider: "ZOOM" })).rejects.toThrow(/meeting link/);
    await expect(
      createEvent(ctx, { ...base, conferenceProvider: "OTHER", conferenceUrl: "http://insecure.example" }),
    ).rejects.toThrow(/https/);
    await expect(
      createEvent(makeCtx({ hostIsMember: false }).ctx, { ...base, hostUserId: "u_outsider" }),
    ).rejects.toThrow(/member/);
  });

  it("updates: 404 for a missing event, re-mirrors an existing Google event, rebuilds on a visibility flip", async () => {
    await expect(updateEvent(makeCtx({ existing: null }).ctx, "nope", { title: "x" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const { ctx, saved } = makeCtx({
      existing: { ...existing, visibility: "PUBLIC", googleEventId: "g1" },
      integrations: [{ provider: "GOOGLE_CALENDAR", config: {} }, { provider: "NETLIFY_BUILD_HOOK" }],
    });
    const result = await updateEvent(ctx, "evt_1", { visibility: "INTERNAL" });
    expect(saved[0]).toMatchObject({ syncVersion: { increment: 1 }, googleSyncState: "PENDING" });
    expect(result.event.syncVersion).toBe(4);
    expect(enqueueJob.mock.calls.map((c) => c[1].kind).sort()).toEqual(["gcal", "site-rebuild"]);
    expect(result.tags).toContain(tags.publicEvents(ORG));
  });

  it("sync-origin saves leave suiteEditedAt alone", async () => {
    const { ctx, saved } = makeCtx({ existing, kind: "system", role: null });
    await updateEvent(ctx, "evt_1", { title: "From the website" }, { origin: "sync" });
    expect(saved[0]).not.toHaveProperty("suiteEditedAt");
  });

  it("deletes softly and removes the Google mirror through a gcal job", async () => {
    const { ctx, saved } = makeCtx({
      existing: { ...existing, googleEventId: "g1" },
      integrations: [{ provider: "GOOGLE_CALENDAR", config: {} }],
    });
    const result = await deleteEvent(ctx, "evt_1");
    expect(saved[0]!.deletedAt).toBeInstanceOf(Date);
    expect(enqueueJob).toHaveBeenCalledWith(ctx.db, expect.objectContaining({ kind: "gcal" }));
    expect(result.tags).toEqual([tags.reports(ORG)]);
  });

  it("publicEventsWhere is PUBLIC, live, unmerged and in the feed window", () => {
    const now = new Date("2026-10-01T00:00:00.000Z");
    expect(publicEventsWhere(ORG, now)).toEqual({
      organizationId: ORG,
      visibility: "PUBLIC",
      deletedAt: null,
      mergedIntoId: null,
      endsAt: { gte: new Date("2026-09-30T00:00:00.000Z") },
      startsAt: { lte: new Date(now.getTime() + 400 * 86_400_000) },
    });
  });
});
