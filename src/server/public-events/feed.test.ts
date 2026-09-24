// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The public events endpoints end to end, with the database replaced by an
 * in-memory table that applies the service's publicEventsWhere() filter
 * literally: whatever the filter lets through is what the routes publish,
 * so these tests prove INTERNAL, deleted, merged, stale and other-org
 * events never leak.
 */

interface Row {
  id: string;
  organizationId: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  kind: string;
  visibility: "PUBLIC" | "INTERNAL";
  rsvpUrl: string | null;
  capacityFull: boolean;
  featured: boolean;
  publicNote: string | null;
  syncVersion: number;
  deletedAt: Date | null;
  mergedIntoId: string | null;
  createdAt: Date;
  updatedAt: Date;
  hostUserId?: string | null;
  conferenceUrl?: string | null;
}

const NOW = new Date("2026-10-01T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function row(partial: Partial<Row> & Pick<Row, "id" | "title">): Row {
  return {
    organizationId: "org_cbc",
    description: null,
    location: "West Village H 110",
    startsAt: new Date(NOW.getTime() + 2 * DAY),
    endsAt: new Date(NOW.getTime() + 2 * DAY + 90 * 60 * 1000),
    allDay: false,
    kind: "WORKSHOP",
    visibility: "PUBLIC",
    rsvpUrl: null,
    capacityFull: false,
    featured: false,
    publicNote: null,
    syncVersion: 1,
    deletedAt: null,
    mergedIntoId: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-02T00:00:00.000Z"),
    hostUserId: "u_secret_host",
    conferenceUrl: "https://meet.google.com/abc-defg-hij",
    ...partial,
  };
}

const table: Row[] = [
  row({ id: "e_pub_2", title: "Workshop 2", rsvpUrl: "https://lu.ma/w2", startsAt: new Date(NOW.getTime() + 3 * DAY), endsAt: new Date(NOW.getTime() + 3 * DAY + HOUR) }),
  row({ id: "e_pub_1", title: "Workshop 1", description: "Bring a laptop.", featured: true }),
  row({ id: "e_pub_1b", title: "Same start, later id" }),
  row({ id: "e_internal", title: "Board sync (INTERNAL)", visibility: "INTERNAL", kind: "BOARD_MEETING" }),
  row({ id: "e_deleted", title: "Deleted workshop", deletedAt: new Date(NOW.getTime() - DAY) }),
  row({ id: "e_merged", title: "Merged duplicate", mergedIntoId: "e_pub_1" }),
  row({ id: "e_old", title: "Last week", startsAt: new Date(NOW.getTime() - 8 * DAY), endsAt: new Date(NOW.getTime() - 8 * DAY + HOUR) }),
  row({ id: "e_yesterday", title: "Ended 20 hours ago", startsAt: new Date(NOW.getTime() - 21 * HOUR), endsAt: new Date(NOW.getTime() - 20 * HOUR) }),
  row({ id: "e_far", title: "Too far out", startsAt: new Date(NOW.getTime() + 500 * DAY), endsAt: new Date(NOW.getTime() + 500 * DAY + HOUR) }),
  row({ id: "e_other_org", title: "Other org public", organizationId: "org_other" }),
  row({
    id: "e_hack",
    title: "Hackathon",
    kind: "HACKATHON",
    allDay: true,
    // Oct 10-11 in New York: local midnight to local midnight after the last day.
    startsAt: new Date("2026-10-10T04:00:00.000Z"),
    endsAt: new Date("2026-10-12T04:00:00.000Z"),
    capacityFull: true,
    publicNote: "Waitlist only",
  }),
];

type Where = Record<string, unknown>;

function matches(r: Row, where: Where): boolean {
  for (const [key, cond] of Object.entries(where)) {
    const value = (r as unknown as Record<string, unknown>)[key];
    if (cond === null) {
      if (value !== null) return false;
    } else if (cond instanceof Date || typeof cond !== "object") {
      if (value !== cond) return false;
    } else {
      const c = cond as { gte?: Date; lte?: Date };
      if (c.gte && !((value as Date) >= c.gte)) return false;
      if (c.lte && !((value as Date) <= c.lte)) return false;
    }
  }
  return true;
}

const { state } = vi.hoisted(() => ({
  state: {
    org: "" as string,
    slugs: new Map<string, { organizationId: string; canonicalSlug: string; isRetired: boolean }>(),
    enabled: new Set<string>(),
  },
}));

vi.mock("@/server/db/context", () => ({
  withSystemOrgTx: async (orgId: string | null, fn: (ctx: unknown) => unknown) => {
    const db = {
      $queryRaw: async (_s: TemplateStringsArray, slug: string) => {
        const r = state.slugs.get(slug);
        return r ? [r] : [];
      },
      orgSettings: {
        findUnique: async ({ where }: { where: { organizationId: string } }) => ({
          publicEventsEnabled: state.enabled.has(where.organizationId),
        }),
      },
      organization: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          where.id === orgId ? { name: "Claude Builders Club", timezone: "America/New_York", deletedAt: null } : null,
      },
      event: {
        findMany: async ({ where, take, select }: { where: Where; take: number; select: Record<string, boolean> }) => {
          // RLS: the service role only sees the GUC org's rows.
          const visible = table.filter((r) => r.organizationId === orgId && matches(r, where));
          visible.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || (a.id < b.id ? -1 : 1));
          return visible.slice(0, take).map((r) =>
            Object.fromEntries(Object.keys(select).map((k) => [k, (r as unknown as Record<string, unknown>)[k]])),
          );
        },
      },
    };
    return fn({ db, organizationId: orgId });
  },
}));
// No Next.js incremental cache in unit tests: the loader falls back to a direct read.
vi.mock("next/cache", () => ({
  unstable_cache: () => async () => {
    throw new Error("incrementalCache missing in unstable_cache");
  },
}));

vi.useFakeTimers({ now: NOW, toFake: ["Date"] });

const jsonRoute = await import("@/app/api/public/[orgSlug]/events/route");
const icsRoute = await import("@/app/api/public/[orgSlug]/events.ics/route");
const { publicEventsWhere } = await import("@/server/events/service");
const { toClubEvent, websiteKind } = await import("./shape");
const { matchesIfNoneMatch, PUBLIC_CACHE_CONTROL } = await import("./http");

function get(path: string, slug: string, headers: Record<string, string> = {}, method = "GET") {
  const route = path.endsWith(".ics") ? icsRoute : jsonRoute;
  const request = new Request(`http://localhost:3407/api/public/${slug}/${path}`, { headers, method });
  const handler = method === "HEAD" ? route.HEAD : route.GET;
  return handler(request, { params: Promise.resolve({ orgSlug: slug }) });
}

beforeEach(() => {
  state.slugs = new Map([
    ["claude-builders-club", { organizationId: "org_cbc", canonicalSlug: "claude-builders-club", isRetired: false }],
    ["cbc-old", { organizationId: "org_cbc", canonicalSlug: "claude-builders-club", isRetired: true }],
    ["quiet-club", { organizationId: "org_other", canonicalSlug: "quiet-club", isRetired: false }],
  ]);
  state.enabled = new Set(["org_cbc"]);
});

describe("GET /api/public/[orgSlug]/events", () => {
  it("returns only PUBLIC, live, unmerged, in-window events of that org, in (start, id) order", async () => {
    const res = await get("events", "claude-builders-club");
    expect(res.status).toBe(200);
    const events = (await res.json()) as { id: string; title: string }[];
    expect(events.map((e) => e.title)).toEqual([
      "Ended 20 hours ago",
      "Workshop 1",
      "Same start, later id",
      "Workshop 2",
      "Hackathon",
    ]);
    const body = JSON.stringify(events);
    for (const leaked of ["INTERNAL", "Board sync", "Deleted", "Merged", "Last week", "Too far", "Other org"]) {
      expect(body).not.toContain(leaked);
    }
    // Field allowlist: nothing about people or meeting links.
    expect(body).not.toContain("u_secret_host");
    expect(body).not.toContain("meet.google.com");
  });

  it("uses the website's ClubEvent shape, with explicit kind, full, featured and note", async () => {
    const res = await get("events", "claude-builders-club");
    const events = (await res.json()) as Record<string, unknown>[];
    const w1 = events.find((e) => e.title === "Workshop 1")!;
    expect(Object.keys(w1)).toEqual([
      "id",
      "title",
      "start",
      "end",
      "location",
      "description",
      "rsvpUrl",
      "url",
      "allDay",
      "kind",
      "full",
      "featured",
      "note",
    ]);
    expect(w1).toMatchObject({
      id: "e_pub_1@localhost:3000",
      description: "Bring a laptop.",
      kind: "workshop",
      featured: true,
      full: false,
      allDay: false,
      note: null,
    });
    const w2 = events.find((e) => e.title === "Workshop 2")!;
    expect(w2).toMatchObject({ rsvpUrl: "https://lu.ma/w2", url: "https://lu.ma/w2" });
    // All-day: org-timezone dates, exclusive end, in the website's ICS form.
    const hack = events.find((e) => e.title === "Hackathon")!;
    expect(hack).toMatchObject({
      start: "2026-10-10T00:00:00.000Z",
      end: "2026-10-12T00:00:00.000Z",
      allDay: true,
      kind: "hackathon",
      full: true,
      note: "Waitlist only",
    });
  });

  it("sets CDN caching, CORS and an ETag, and answers a matching If-None-Match with 304", async () => {
    const res = await get("events", "claude-builders-club");
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=300, stale-while-revalidate=86400");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    const etag = res.headers.get("etag")!;
    expect(etag).toMatch(/^"[A-Za-z0-9_-]+"$/);

    const again = await get("events", "claude-builders-club", { "if-none-match": etag });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    expect(again.headers.get("etag")).toBe(etag);
    expect(again.headers.get("cache-control")).toBe(PUBLIC_CACHE_CONTROL);

    const weak = await get("events", "claude-builders-club", { "if-none-match": `W/${etag}` });
    expect(weak.status).toBe(304);
    const other = await get("events", "claude-builders-club", { "if-none-match": '"nope"' });
    expect(other.status).toBe(200);
  });

  it("is byte-identical across calls", async () => {
    const a = await (await get("events", "claude-builders-club")).text();
    const b = await (await get("events", "claude-builders-club")).text();
    expect(a).toBe(b);
  });

  it("answers an unknown slug and a disabled org with the same 404", async () => {
    const unknown = await get("events", "no-such-club");
    const disabled = await get("events", "quiet-club");
    expect(unknown.status).toBe(404);
    expect(disabled.status).toBe(404);
    expect(await unknown.text()).toBe(await disabled.text());
    expect([...unknown.headers.entries()]).toEqual([...disabled.headers.entries()]);
  });

  it("stops publishing the moment an org turns the feed off", async () => {
    state.enabled.delete("org_cbc");
    expect((await get("events", "claude-builders-club")).status).toBe(404);
  });

  it("redirects a retired slug (307, no-store) to the canonical feed", async () => {
    const res = await get("events", "cbc-old");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3407/api/public/claude-builders-club/events");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("never queries for a malformed slug", async () => {
    const res = await get("events", "Robert'); DROP TABLE");
    expect(res.status).toBe(404);
  });

  it("answers HEAD with headers only and OPTIONS as a CORS preflight", async () => {
    const head = await get("events", "claude-builders-club", {}, "HEAD");
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const pre = jsonRoute.OPTIONS();
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-methods")).toContain("GET");
  });
});

describe("GET /api/public/[orgSlug]/events.ics", () => {
  it("publishes the same events as iCalendar with the RSVP link on line 1", async () => {
    const res = await get("events.ics", "claude-builders-club");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe(PUBLIC_CACHE_CONTROL);
    const ics = (await res.text()).replace(/\r\n /g, "");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(5);
    expect(ics).not.toContain("Board sync");
    expect(ics).toContain("UID:e_pub_2@localhost:3000");
    expect(ics).toContain("DESCRIPTION:https://lu.ma/w2\r\n");
    expect(ics).toContain("URL:https://lu.ma/w2");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261010");
    expect(ics).toContain("DTEND;VALUE=DATE:20261012");
    expect(ics).toContain("X-WR-CALNAME:Claude Builders Club events");
  });

  it("404s exactly like the JSON feed", async () => {
    expect((await get("events.ics", "quiet-club")).status).toBe(404);
    expect((await get("events.ics", "cbc-old")).headers.get("location")).toMatch(/\/events\.ics$/);
  });
});

describe("feed pieces", () => {
  it("publicEventsWhere is PUBLIC, live, unmerged and windowed", () => {
    expect(publicEventsWhere("o", NOW)).toEqual({
      organizationId: "o",
      visibility: "PUBLIC",
      deletedAt: null,
      mergedIntoId: null,
      endsAt: { gte: new Date(NOW.getTime() - DAY) },
      startsAt: { lte: new Date(NOW.getTime() + 400 * DAY) },
    });
  });

  it("maps suite kinds to the website's", () => {
    expect(websiteKind("INFO_SESSION" as never)).toBe("info");
    expect(websiteKind("SOCIAL" as never)).toBe("social");
    expect(websiteKind("OTHER" as never)).toBeNull();
    expect(websiteKind("BOARD_MEETING" as never)).toBeNull();
  });

  it("drops a non-http RSVP link", () => {
    const e = toClubEvent(
      {
        id: "x",
        title: "t",
        description: null,
        location: null,
        startsAt: NOW.toISOString(),
        endsAt: NOW.toISOString(),
        allDay: false,
        kind: "WORKSHOP" as never,
        rsvpUrl: "javascript:alert(1)",
        capacityFull: false,
        featured: false,
        publicNote: null,
        syncVersion: 1,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      },
      { timeZone: "UTC", uidHost: "h" },
    );
    expect(e.rsvpUrl).toBeNull();
    expect(e.end).toBeNull();
  });

  it("compares If-None-Match lists", () => {
    expect(matchesIfNoneMatch('"a", "b"', '"b"')).toBe(true);
    expect(matchesIfNoneMatch("*", '"b"')).toBe(true);
    expect(matchesIfNoneMatch(null, '"b"')).toBe(false);
  });
});
