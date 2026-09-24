// @vitest-environment node
// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The calendar against the real roles and policies of the local database
 * (seeded Claude Builders Club): the public feed loader's filter under the
 * service role, the event service's ADMIN+ rule on the member path, and the
 * gcal job's compare-and-set write. Google itself is a mocked fetch.
 * Skipped when the database or the seed is not there.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock, getSession: vi.fn() }));

import { ForbiddenError } from "@/lib/auth/errors";
import { loadPublicEvents } from "@/server/cached/public-events";
import { authDb, disconnectAll } from "@/server/db/clients";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";
import { withOrgAction, withSystemOrgTx } from "@/server/db/context";
import { createEvent, deleteEvent } from "@/server/events/service";

import { googleEventId } from "./mapping";
import { gcalJob, syncDeps } from "./sync";

interface Person {
  id: string;
  email: string;
  name: string | null;
}

let seeded: { cbcId: string; oliver: Person; kristine: Person } | null = null;
try {
  const [cbc, oliver, kristine] = await Promise.all([
    ownerDb.organization.findUnique({ where: { slug: "claude-builders-club" }, select: { id: true } }),
    authDb.user.findUnique({ where: { email: "oliver@example.edu" }, select: { id: true, email: true, name: true } }),
    authDb.user.findUnique({ where: { email: "kristine@example.edu" }, select: { id: true, email: true, name: true } }),
  ]);
  if (cbc && oliver && kristine) seeded = { cbcId: cbc.id, oliver, kristine };
} catch {
  seeded = null;
}

describe.skipIf(!seeded)("calendar against the local database (seeded CBC)", () => {
  const s = seeded!;
  const created: string[] = [];
  const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const later = new Date(soon.getTime() + 90 * 60 * 1000);

  const asAdmin = withOrgAction(async (ctx, input: Parameters<typeof createEvent>[1]) => {
    const { event } = await createEvent(ctx, input);
    created.push(event.id);
    return event;
  });

  beforeEach(() => {
    requireUserMock.mockResolvedValue(s.oliver);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterAll(async () => {
    await withSystemOrgTx(s.cbcId, async ({ db }) => {
      if (created.length) await db.event.deleteMany({ where: { id: { in: created } } });
      await db.orgIntegration.deleteMany({
        where: { organizationId: s.cbcId, provider: "GOOGLE_CALENDAR", config: { path: ["b7Test"], equals: true } },
      });
    });
    await disconnectAll();
    await disconnectOwnerDb();
  });

  it("the public feed holds only PUBLIC, live, unmerged, in-window events of the org", async () => {
    const feed = await loadPublicEvents(s.cbcId);
    expect(feed).not.toBeNull();
    expect(feed!.events.length).toBeGreaterThan(0);
    const ids = feed!.events.map((e) => e.id);
    const rows = await withSystemOrgTx(s.cbcId, ({ db }) =>
      db.event.findMany({ where: { id: { in: ids } }, select: { visibility: true, deletedAt: true, mergedIntoId: true } }),
    );
    expect(rows).toHaveLength(ids.length);
    expect(rows.every((r) => r.visibility === "PUBLIC" && !r.deletedAt && !r.mergedIntoId)).toBe(true);
    expect(feed!.events.some((e) => /exec sync/i.test(e.title))).toBe(false);
    const sorted = [...feed!.events].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || (a.id < b.id ? -1 : 1));
    expect(feed!.events.map((e) => e.id)).toEqual(sorted.map((e) => e.id));
  });

  it("an ADMIN's PUBLIC event appears, INTERNAL and deleted ones never do", async () => {
    const pub = await asAdmin(s.cbcId, {
      title: "B7 test public workshop",
      startsAt: soon,
      endsAt: later,
      kind: "WORKSHOP",
      visibility: "PUBLIC",
      rsvpUrl: "https://lu.ma/b7-test",
    });
    const internal = await asAdmin(s.cbcId, { title: "B7 test board sync", startsAt: soon, endsAt: later });
    let titles = (await loadPublicEvents(s.cbcId))!.events.map((e) => e.title);
    expect(titles).toContain("B7 test public workshop");
    expect(titles).not.toContain("B7 test board sync");
    expect(internal.visibility).toBe("INTERNAL");

    await withOrgAction(async (ctx) => deleteEvent(ctx, pub.id))(s.cbcId);
    titles = (await loadPublicEvents(s.cbcId))!.events.map((e) => e.title);
    expect(titles).not.toContain("B7 test public workshop");
  });

  it("a MEMBER can create no event through the service, and no PUBLIC one even directly", async () => {
    requireUserMock.mockResolvedValue(s.kristine);
    await expect(
      withOrgAction(async (ctx) => createEvent(ctx, { title: "nope", startsAt: soon, endsAt: later }))(s.cbcId),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      withOrgAction(async (ctx) =>
        ctx.db.event.create({
          data: {
            organizationId: s.cbcId,
            title: "direct public",
            startsAt: soon,
            endsAt: later,
            createdById: s.kristine.id,
            visibility: "PUBLIC",
          },
        }),
      )(s.cbcId),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("gcal mirrors an event and writes SYNCED with a compare-and-set, leaving updatedAt alone", async () => {
    const event = await asAdmin(s.cbcId, {
      title: "B7 test mirrored workshop",
      startsAt: soon,
      endsAt: later,
      kind: "WORKSHOP",
      visibility: "PUBLIC",
    });
    // Connect Google only now, so the create above queued no job.
    await withSystemOrgTx(s.cbcId, async ({ db }) => {
      await db.orgIntegration.upsert({
        where: { organizationId_provider: { organizationId: s.cbcId, provider: "GOOGLE_CALENDAR" } },
        create: {
          organizationId: s.cbcId,
          provider: "GOOGLE_CALENDAR",
          status: "CONNECTED",
          config: { publicCalendarId: "club@group.calendar.google.com", b7Test: true },
        },
        update: {},
      });
      await db.event.update({ where: { id: event.id }, data: { googleSyncState: "PENDING", updatedAt: event.updatedAt } });
    });
    const inserted: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: URL, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        inserted.push(body);
        return new Response(JSON.stringify({ ...body, etag: '"1"', htmlLink: "https://www.google.com/calendar/event?eid=x" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const original = syncDeps.getAccessToken;
    syncDeps.getAccessToken = async () => "ya29.test";
    try {
      await gcalJob({
        id: "job_test",
        kind: "gcal",
        organizationId: s.cbcId,
        payload: { eventId: event.id },
        dedupeKey: `gcal:${event.id}`,
        attempt: 1,
        maxAttempts: 8,
        signal: new AbortController().signal,
        deadline: Date.now() + 30_000,
      });
    } finally {
      syncDeps.getAccessToken = original;
      vi.unstubAllGlobals();
    }
    expect(inserted).toHaveLength(1);
    const row = await withSystemOrgTx(s.cbcId, ({ db }) =>
      db.event.findUniqueOrThrow({
        where: { id: event.id },
        select: { googleSyncState: true, googleEventId: true, googleEtag: true, googleHtmlLink: true, updatedAt: true },
      }),
    );
    expect(row).toMatchObject({
      googleSyncState: "SYNCED",
      googleEventId: googleEventId(s.cbcId, event.id),
      googleEtag: '"1"',
    });
    expect(row.updatedAt.getTime()).toBe(event.updatedAt.getTime());
  });
});
