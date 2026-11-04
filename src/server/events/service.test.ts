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
  /** The org's meeting reminder default; null is an org with no settings row (the default is [1440, 60]). */
  orgReminders?: number[] | null;
}) {
  const saved: Record<string, unknown>[] = [];
  const db = {
    membership: { count: vi.fn(async () => (opts.hostIsMember === false ? 0 : 1)) },
    orgIntegration: { findMany: vi.fn(async () => opts.integrations ?? []) },
    orgSettings: {
      findUnique: vi.fn(async () =>
        opts.orgReminders === null
          ? null
          : { meetingReminderMinutes: opts.orgReminders ?? [1440, 60] },
      ),
    },
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
      integrations: [
        { provider: "GOOGLE_CALENDAR", config: { publicCalendarId: "cal_pub" } },
        { provider: "NETLIFY_BUILD_HOOK" },
      ],
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

  it("a PUBLIC event is mirrored only when a public calendar is configured (never a default one)", async () => {
    // Just connected, or "Don't mirror public events": publicCalendarId is null.
    for (const config of [{}, { publicCalendarId: null, internalCalendarId: "cal_int" }]) {
      const { ctx, saved } = makeCtx({
        integrations: [{ provider: "GOOGLE_CALENDAR", config }, { provider: "NETLIFY_BUILD_HOOK" }],
      });
      await createEvent(ctx, { ...base, visibility: "PUBLIC", kind: "WORKSHOP" });
      expect(saved[0]).toMatchObject({ googleSyncState: "NOT_APPLICABLE" });
      // The website still rebuilds; only Google is left out.
      expect(enqueueJob.mock.calls.map((c) => c[1].kind)).toEqual(["site-rebuild"]);
      enqueueJob.mockClear();
    }
  });

  it("validates times, links, the RSVP URL and the host", async () => {
    const { ctx } = makeCtx({});
    await expect(createEvent(ctx, { ...base, endsAt: "2026-10-01T21:00:00.000Z" })).rejects.toBeInstanceOf(
      EventValidationError,
    );
    await expect(createEvent(ctx, { ...base, rsvpUrl: "javascript:alert(1)" })).rejects.toBeInstanceOf(
      EventValidationError,
    );
    // An empty link against a provider we can call is not a mistake: it
    // means "make the meeting for me" (docs/features/meetings.md). OTHER
    // still needs one pasted, because there is nothing for us to call.
    await expect(createEvent(ctx, { ...base, conferenceProvider: "OTHER" })).rejects.toThrow(
      /meeting link/,
    );
    await expect(
      createEvent(ctx, { ...base, conferenceProvider: "OTHER", conferenceUrl: "http://insecure.example" }),
    ).rejects.toThrow(/https/);
    await expect(
      createEvent(makeCtx({ hostIsMember: false }).ctx, { ...base, hostUserId: "u_outsider" }),
    ).rejects.toThrow(/member/);
  });

  it("stores how to find the place trimmed, none when it is empty, and refuses more than 1,000 characters", async () => {
    const { ctx, saved } = makeCtx({});
    await createEvent(ctx, {
      ...base,
      location: "Curry 344",
      locationDetails: "  Second floor.  ",
    });
    expect(saved[0]).toMatchObject({ location: "Curry 344", locationDetails: "Second floor." });

    await createEvent(ctx, { ...base, locationDetails: "   " });
    expect(saved[1]!.locationDetails).toBeNull();
    await createEvent(ctx, { ...base, locationDetails: "x".repeat(1000) });
    expect(saved[2]!.locationDetails).toBe("x".repeat(1000));
    await expect(
      createEvent(ctx, { ...base, locationDetails: "x".repeat(1001) }),
    ).rejects.toBeInstanceOf(EventValidationError);
  });

  it("a patch changes how to find the place only when it names it, and can clear it", async () => {
    const { ctx, saved } = makeCtx({ existing: { ...existing, locationDetails: "Second floor." } });
    await updateEvent(ctx, "evt_1", { title: "Renamed" });
    expect(saved[0]).not.toHaveProperty("locationDetails");
    await updateEvent(ctx, "evt_1", { locationDetails: "Ring the bell." });
    expect(saved[1]!.locationDetails).toBe("Ring the bell.");
    await updateEvent(ctx, "evt_1", { locationDetails: null });
    expect(saved[2]!.locationDetails).toBeNull();
  });

  it("a new event takes the org's reminder default, or one day and one hour with no settings row", async () => {
    const withDefault = makeCtx({ orgReminders: [30] });
    await createEvent(withDefault.ctx, base);
    expect(withDefault.saved[0]!.reminderMinutes).toEqual([30]);
    expect(withDefault.db.orgSettings.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: ORG } }),
    );

    const noRow = makeCtx({ orgReminders: null });
    await createEvent(noRow.ctx, base);
    expect(noRow.saved[0]!.reminderMinutes).toEqual([1440, 60]);
  });

  it("an event's own reminders win over the default, are stored earliest first, and skip the lookup", async () => {
    const { ctx, db, saved } = makeCtx({ orgReminders: [30] });
    await createEvent(ctx, { ...base, reminderMinutes: [10, 1440] });
    expect(saved[0]!.reminderMinutes).toEqual([1440, 10]);
    expect(db.orgSettings.findUnique).not.toHaveBeenCalled();

    // An empty list is a choice (no reminders), not a missing one.
    await createEvent(ctx, { ...base, reminderMinutes: [] });
    expect(saved[1]!.reminderMinutes).toEqual([]);
    expect(db.orgSettings.findUnique).not.toHaveBeenCalled();
  });

  it("refuses a bad reminder list with the schema's sentence, before saving anything", async () => {
    const { ctx, db } = makeCtx({});
    for (const reminderMinutes of [[60, 60], [0], [40321], [1.5], [1, 2, 3, 4, 5, 6, 7, 8, 9]]) {
      await expect(createEvent(ctx, { ...base, reminderMinutes })).rejects.toBeInstanceOf(
        EventValidationError,
      );
    }
    expect(db.event.create).not.toHaveBeenCalled();
    await expect(
      updateEvent(makeCtx({ existing }).ctx, "evt_1", { reminderMinutes: [60, 60] }),
    ).rejects.toBeInstanceOf(EventValidationError);
  });

  it("a patch changes reminders only when it names them", async () => {
    const { ctx, saved } = makeCtx({ existing: { ...existing, reminderMinutes: [1440, 60] } });
    await updateEvent(ctx, "evt_1", { title: "Renamed" });
    expect(saved[0]).not.toHaveProperty("reminderMinutes");
    await updateEvent(ctx, "evt_1", { reminderMinutes: [30, 120] });
    expect(saved[1]!.reminderMinutes).toEqual([120, 30]);
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
