// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Google workers under the job-runner contract, end to end:
 * - the REAL transaction wrappers (src/server/db/context.ts) over an
 *   in-memory database fake, so assertNoTx is live: a handler that called
 *   Google inside a transaction would fail these tests;
 * - the REAL REST client over a mocked fetch that behaves like the Google
 *   Calendar v3 API (409 on a duplicate id, 404/410 on missing/deleted).
 */

// ---------------------------------------------------------------- fakes --

type Row = Record<string, unknown> & { id: string; organizationId: string };

interface Store {
  org: string | null;
  events: Map<string, Row>;
  integrations: Row[];
  orgs: Map<string, Row>;
  members: Row[];
  notifications: Row[];
  jobs: { orgId: string; kind: string; key: string; payload: unknown }[];
  audits: string[];
  linkLogs: Row[];
}

const { store, requireUserMock, secrets, invalidateMock } = vi.hoisted(() => ({
  store: {} as Store,
  requireUserMock: vi.fn(),
  secrets: new Map<string, string>(),
  invalidateMock: vi.fn(),
}));

function matchWhere(row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
  for (const [key, cond] of Object.entries(where ?? {})) {
    if (key === "OR") {
      if (!(cond as Record<string, unknown>[]).some((w) => matchWhere(row, w))) return false;
      continue;
    }
    if (key === "NOT") {
      if (matchWhere(row, cond as Record<string, unknown>)) return false;
      continue;
    }
    if (key === "organizationId_provider") {
      const c = cond as { organizationId: string; provider: string };
      if (row.organizationId !== c.organizationId || row.provider !== c.provider) return false;
      continue;
    }
    const value = row[key];
    if (cond === undefined) continue;
    if (cond === null) {
      if (value !== null && value !== undefined) return false;
    } else if (cond instanceof Date) {
      if (!(value instanceof Date) || value.getTime() !== cond.getTime()) return false;
    } else if (typeof cond === "object") {
      const c = cond as { in?: unknown[]; not?: unknown; gte?: Date; lte?: Date };
      if (c.in && !c.in.includes(value)) return false;
      if ("not" in c && (c.not === null ? value === null || value === undefined : value === c.not)) return false;
      if (c.gte && !((value as Date) >= c.gte)) return false;
      if (c.lte && !((value as Date) <= c.lte)) return false;
    } else if (value !== cond) {
      return false;
    }
  }
  return true;
}

function applyData(row: Row, data: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (v && typeof v === "object" && !(v instanceof Date) && "increment" in (v as object)) {
      row[k] = Number(row[k] ?? 0) + (v as { increment: number }).increment;
    } else row[k] = v;
  }
  if (!("updatedAt" in data)) row.updatedAt = new Date(Date.now() + 1); // Prisma's @updatedAt
}

let jobSeq = 0;
function makeTx() {
  const visible = (r: Row) => r.organizationId === store.org;
  const clone = <T,>(r: T): T => (r ? { ...(r as object) } : r) as T;
  return {
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join("?");
      if (sql.includes("app.set_context")) {
        store.org = (values[1] as string) || null;
        return [{ role: null }];
      }
      if (sql.includes("app.enqueue_job")) {
        const dedupe = values[2] as string;
        store.jobs.push({
          orgId: values[0] as string,
          kind: values[1] as string,
          key: dedupe.slice((values[1] as string).length + 1),
          payload: JSON.parse(values[3] as string),
        });
        return [{ id: `job_${++jobSeq}` }];
      }
      if (sql.includes("app.write_org_audit")) {
        store.audits.push(values[1] as string);
        return [{ id: "audit" }];
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
    async $executeRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join("?");
      let n = 0;
      if (sql.includes("'PENDING'::\"CalendarSyncState\"") && sql.includes("ANY(")) {
        for (const id of values[1] as string[]) {
          const r = store.events.get(id);
          if (r && r.organizationId === values[0]) {
            r.googleSyncState = "PENDING";
            n += 1;
          }
        }
      } else if (sql.includes("'NOT_APPLICABLE'")) {
        for (const r of store.events.values()) {
          if (r.organizationId === values[0] && ["PENDING", "FAILED"].includes(r.googleSyncState as string)) {
            r.googleSyncState = "NOT_APPLICABLE";
            r.googleSyncError = null;
            n += 1;
          }
        }
      } else throw new Error(`unexpected SQL: ${sql}`);
      return n;
    },
    event: {
      async findFirst({ where }: { where: Record<string, unknown> }) {
        return clone([...store.events.values()].find((r) => visible(r) && matchWhere(r, where)) ?? null);
      },
      async findMany({ where, take }: { where: Record<string, unknown>; take?: number }) {
        const rows = [...store.events.values()]
          .filter((r) => visible(r) && matchWhere(r, where))
          .sort((a, b) => (a.startsAt as Date).getTime() - (b.startsAt as Date).getTime());
        return rows.slice(0, take ?? rows.length).map(clone);
      },
      async updateMany({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
        let count = 0;
        for (const r of store.events.values()) {
          if (visible(r) && matchWhere(r, where)) {
            applyData(r, data);
            count += 1;
          }
        }
        return { count };
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const id = `evt_new_${store.events.size + 1}`;
        const row: Row = {
          id,
          organizationId: data.organizationId as string,
          description: null,
          location: null,
          rsvpUrl: null,
          conferenceUrl: null,
          publicNote: null,
          capacityFull: false,
          featured: false,
          deletedAt: null,
          mergedIntoId: null,
          googleCalendarId: null,
          googleEventId: null,
          googleEtag: null,
          googleHtmlLink: null,
          googleSyncError: null,
          googleSyncAttempts: 0,
          needsReview: false,
          hostUserId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        store.events.set(id, row);
        return clone(row);
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const r = store.events.get(where.id);
        if (!r || !visible(r)) throw new Error("not found");
        applyData(r, data);
        return clone(r);
      },
    },
    organization: {
      async findUnique({ where }: { where: { id: string } }) {
        return where.id === store.org ? clone(store.orgs.get(where.id) ?? null) : null;
      },
    },
    orgIntegration: {
      async findUnique({ where }: { where: Record<string, unknown> }) {
        return clone(store.integrations.find((r) => visible(r) && matchWhere(r, where)) ?? null);
      },
      async findFirst({ where }: { where: Record<string, unknown> }) {
        return clone(store.integrations.find((r) => visible(r) && matchWhere(r, where)) ?? null);
      },
      async findMany({ where }: { where: Record<string, unknown> }) {
        return store.integrations.filter((r) => visible(r) && matchWhere(r, where)).map(clone);
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const r = store.integrations.find((i) => i.id === where.id && visible(i));
        if (!r) throw new Error("not found");
        Object.assign(r, data);
        return clone(r);
      },
      async updateMany({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
        const rows = store.integrations.filter((r) => visible(r) && matchWhere(r, where));
        for (const r of rows) Object.assign(r, data);
        return { count: rows.length };
      },
    },
    membership: {
      async findMany({ where }: { where: Record<string, unknown> }) {
        return store.members.filter((r) => visible(r) && matchWhere(r, where)).map(clone);
      },
      async findFirst({ where }: { where: Record<string, unknown> }) {
        return clone(store.members.find((r) => visible(r) && matchWhere(r, where)) ?? null);
      },
      async count({ where }: { where: Record<string, unknown> }) {
        return store.members.filter((r) => visible(r) && matchWhere(r, where)).length;
      },
    },
    notification: {
      async createMany({ data }: { data: Row[] }) {
        store.notifications.push(...data);
        return { count: data.length };
      },
    },
    eventLinkLog: {
      async create({ data }: { data: Row }) {
        store.linkLogs.push(data);
        return data;
      },
    },
  };
}

vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: invalidateMock }));
vi.mock("@/server/secrets", () => ({
  getSecret: async ({ orgId, kind }: { orgId: string; kind: string }) => secrets.get(`${orgId}:${kind}`) ?? null,
}));
vi.mock("@/server/db/clients", () => {
  const client = { $transaction: async (fn: (tx: unknown) => unknown) => fn(makeTx()) };
  return { appDb: client, serviceDb: client, authDb: client, getClient: () => client };
});

// A tiny Google Calendar v3.
interface GEvent extends Record<string, unknown> {
  id: string;
  status: string;
  etag: string;
}
const google = {
  calendars: new Map<string, Map<string, GEvent>>(),
  calls: [] as string[],
  inject: [] as { method: string; status: number; reason?: string }[],
  hook: null as null | ((method: string, calendarId: string, eventId?: string) => void),
  token: { status: 200, body: { access_token: "ya29.test-token", expires_in: 3600 } as Record<string, unknown> },
  tokenCalls: 0,
};

function cal(id: string): Map<string, GEvent> {
  let c = google.calendars.get(id);
  if (!c) google.calendars.set(id, (c = new Map()));
  return c;
}

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
  const method = (init.method ?? "GET").toUpperCase();
  if (url.host === "oauth2.googleapis.com") {
    google.tokenCalls += 1;
    return json(google.token.status, google.token.body);
  }
  const m = /^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(url.pathname);
  if (!m) return json(404, { error: { message: "no route" } });
  const calendarId = decodeURIComponent(m[1]);
  const eventId = m[2] ? decodeURIComponent(m[2]) : undefined;
  google.calls.push(`${method} ${calendarId}${eventId ? `/${eventId.slice(0, 8)}` : ""}`);
  google.hook?.(method, calendarId, eventId);
  const injected = google.inject.findIndex((i) => i.method === method);
  if (injected >= 0) {
    const [i] = google.inject.splice(injected, 1);
    return json(i.status, { error: { code: i.status, message: `injected ${i.status}`, errors: [{ reason: i.reason ?? "x" }] } });
  }
  const events = cal(calendarId);
  const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  switch (method) {
    case "POST": {
      const id = String(body.id);
      if (events.has(id)) return json(409, { error: { message: "The requested identifier already exists.", errors: [{ reason: "duplicate" }] } });
      const e: GEvent = { ...body, id, status: "confirmed", etag: '"1"', htmlLink: `https://www.google.com/calendar/event?eid=${id.slice(0, 6)}` };
      events.set(id, e);
      return json(200, e);
    }
    case "GET": {
      if (!eventId) return json(200, { items: [...events.values()].filter((e) => e.status !== "cancelled") });
      const e = events.get(eventId);
      return e ? json(200, e) : json(404, { error: { message: "Not Found", errors: [{ reason: "notFound" }] } });
    }
    case "PATCH": {
      const e = eventId ? events.get(eventId) : undefined;
      if (!e) return json(404, { error: { message: "Not Found", errors: [{ reason: "notFound" }] } });
      Object.assign(e, body, { etag: `"${Number(String(e.etag).replace(/"/g, "")) + 1}"` });
      return json(200, e);
    }
    case "DELETE": {
      const e = eventId ? events.get(eventId) : undefined;
      if (!e) return json(404, { error: { message: "Not Found", errors: [{ reason: "notFound" }] } });
      if (e.status === "cancelled") return json(410, { error: { message: "Resource has been deleted", errors: [{ reason: "deleted" }] } });
      e.status = "cancelled";
      return new Response(null, { status: 204 });
    }
  }
  return json(405, {});
}

// ---------------------------------------------------------------- setup --

const { gcalJob, syncDeps, pushToGoogle } = await import("./sync");
const { googleImportJob } = await import("./import");
const { googleRevokeJob } = await import("./revoke");
const { siteRebuildJob, parseBuildHookUrl } = await import("@/server/public-events/rebuild");
const { createCalendarClient } = await import("./client");
const { getAccessToken, clearAllAccessTokens, GoogleReauthError, GoogleNotConfiguredError } = await import("./token");
const { googleEventId } = await import("./mapping");
const { withSystemOrgTx, NetworkInTransactionError } = await import("@/server/db/context");
const { PermanentJobError } = await import("@/server/jobs/types");
const { updateEvent, deleteEvent } = await import("@/server/events/service");
const { implementedKinds } = await import("@/server/jobs/registry");

const ORG = "org_cbc";
const PUBLIC_CAL = "club@group.calendar.google.com";
const INTERNAL_CAL = "board@group.calendar.google.com";
const realGetAccessToken = syncDeps.getAccessToken;

function event(id: string, extra: Record<string, unknown> = {}): Row {
  return {
    id,
    organizationId: ORG,
    title: `Workshop ${id}`,
    description: "Bring a laptop.",
    location: "West Village H 110",
    startsAt: new Date("2026-10-06T22:00:00.000Z"),
    endsAt: new Date("2026-10-06T23:30:00.000Z"),
    allDay: false,
    kind: "WORKSHOP",
    visibility: "PUBLIC",
    rsvpUrl: "https://lu.ma/w",
    conferenceProvider: "NONE",
    conferenceUrl: null,
    publicNote: null,
    capacityFull: false,
    hostUserId: null,
    deletedAt: null,
    mergedIntoId: null,
    syncVersion: 1,
    googleCalendarId: null,
    googleEventId: null,
    googleEtag: null,
    googleHtmlLink: null,
    googleSyncState: "PENDING",
    googleSyncAttempts: 0,
    googleSyncError: null,
    createdById: "u_owner",
    updatedAt: new Date("2026-09-20T12:00:00.000Z"),
    createdAt: new Date("2026-09-20T12:00:00.000Z"),
    ...extra,
  };
}

function run(eventId: string, attempt = 1) {
  const controller = new AbortController();
  return {
    id: `job_${eventId}`,
    kind: "gcal",
    organizationId: ORG,
    payload: { eventId },
    dedupeKey: `gcal:${eventId}`,
    attempt,
    maxAttempts: 8,
    signal: controller.signal,
    deadline: Date.now() + 30_000,
  };
}

function ev(id: string): Row {
  return store.events.get(id)!;
}

function liveGoogle(calendarId: string): GEvent[] {
  return [...cal(calendarId).values()].filter((e) => e.status !== "cancelled");
}

beforeEach(() => {
  Object.assign(store, {
    org: null,
    events: new Map(),
    integrations: [
      {
        id: "int_google",
        organizationId: ORG,
        provider: "GOOGLE_CALENDAR",
        status: "CONNECTED",
        config: { publicCalendarId: PUBLIC_CAL },
        connectedById: "u_admin",
        lastError: null,
      },
      { id: "int_hook", organizationId: ORG, provider: "NETLIFY_BUILD_HOOK", status: "CONNECTED", config: {} },
    ],
    orgs: new Map([[ORG, { id: ORG, organizationId: ORG, slug: "claude-builders-club", timezone: "America/New_York", name: "CBC" }]]),
    members: [
      { id: "m1", organizationId: ORG, userId: "u_owner", role: "OWNER", joinedAt: new Date(0) },
      { id: "m2", organizationId: ORG, userId: "u_admin", role: "ADMIN", joinedAt: new Date(1) },
      { id: "m3", organizationId: ORG, userId: "u_member", role: "MEMBER", joinedAt: new Date(2) },
    ],
    notifications: [],
    jobs: [],
    audits: [],
    linkLogs: [],
  } satisfies Store);
  google.calendars = new Map();
  google.calls = [];
  google.inject = [];
  google.hook = null;
  google.tokenCalls = 0;
  google.token = { status: 200, body: { access_token: "ya29.test-token", expires_in: 3600 } };
  secrets.clear();
  secrets.set(`${ORG}:REFRESH_TOKEN`, "1//0refresh-token-value");
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  syncDeps.getAccessToken = vi.fn(async () => "ya29.test-token");
  clearAllAccessTokens();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  syncDeps.getAccessToken = realGetAccessToken;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------- tests --

describe("gcal: mirroring one event", () => {
  it("inserts a PUBLIC event into the public calendar under its deterministic id", async () => {
    store.events.set("e1", event("e1"));
    await gcalJob(run("e1"));
    const id = googleEventId(ORG, "e1");
    expect(liveGoogle(PUBLIC_CAL).map((e) => e.id)).toEqual([id]);
    expect(ev("e1")).toMatchObject({
      googleSyncState: "SYNCED",
      googleCalendarId: PUBLIC_CAL,
      googleEventId: id,
      googleEtag: '"1"',
      googleSyncError: null,
    });
    expect(ev("e1").googleHtmlLink).toMatch(/^https:\/\/www\.google\.com\/calendar\/event/);
    // Mirroring is not an edit.
    expect((ev("e1").updatedAt as Date).toISOString()).toBe("2026-09-20T12:00:00.000Z");
    const g = cal(PUBLIC_CAL).get(id)!;
    expect(String(g.description).split("\n")[0]).toBe("https://lu.ma/w");
    expect(g.start).toEqual({ dateTime: "2026-10-06T22:00:00.000Z", timeZone: "America/New_York" });
  });

  it("is idempotent: a second run patches, it never duplicates", async () => {
    store.events.set("e1", event("e1"));
    await gcalJob(run("e1"));
    ev("e1").title = "Workshop renamed";
    ev("e1").syncVersion = 2;
    await gcalJob(run("e1"));
    await gcalJob(run("e1"));
    expect(liveGoogle(PUBLIC_CAL)).toHaveLength(1);
    expect(liveGoogle(PUBLIC_CAL)[0].summary).toBe("Workshop renamed");
    expect(google.calls.filter((c) => c.startsWith("POST"))).toHaveLength(1);
  });

  it("turns a 409 on insert (a lost response) into get + patch", async () => {
    const id = googleEventId(ORG, "e1");
    cal(PUBLIC_CAL).set(id, { id, status: "confirmed", etag: '"7"', summary: "stale" });
    store.events.set("e1", event("e1"));
    await gcalJob(run("e1"));
    expect(google.calls.map((c) => c.split(" ")[0])).toEqual(["POST", "GET", "PATCH"]);
    expect(liveGoogle(PUBLIC_CAL)).toHaveLength(1);
    expect(ev("e1")).toMatchObject({ googleSyncState: "SYNCED", googleEventId: id, googleEtag: '"8"' });
  });

  it("restores a mirror someone deleted in Google (409 on a cancelled id)", async () => {
    const id = googleEventId(ORG, "e1");
    cal(PUBLIC_CAL).set(id, { id, status: "cancelled", etag: '"3"' });
    store.events.set("e1", event("e1"));
    await gcalJob(run("e1"));
    expect(cal(PUBLIC_CAL).get(id)?.status).toBe("confirmed");
  });

  it.each([404, 410])("re-inserts when a patch answers %i", async (status) => {
    store.events.set(
      "e1",
      event("e1", { googleCalendarId: PUBLIC_CAL, googleEventId: "hand_made_id", googleSyncState: "PENDING" }),
    );
    google.inject.push({ method: "PATCH", status, reason: status === 404 ? "notFound" : "deleted" });
    await gcalJob(run("e1"));
    expect(ev("e1")).toMatchObject({ googleSyncState: "SYNCED", googleEventId: googleEventId(ORG, "e1") });
    expect(liveGoogle(PUBLIC_CAL)).toHaveLength(1);
  });

  it.each([404, 410])("treats %i on delete as done", async (status) => {
    store.events.set(
      "e1",
      event("e1", { googleCalendarId: PUBLIC_CAL, googleEventId: "gone", deletedAt: new Date(), syncVersion: 3 }),
    );
    google.inject.push({ method: "DELETE", status });
    await gcalJob(run("e1"));
    expect(ev("e1")).toMatchObject({ googleSyncState: "NOT_APPLICABLE", googleEventId: null, googleCalendarId: null });
  });

  it("deletes the mirror when the event is deleted", async () => {
    store.events.set("e1", event("e1"));
    await gcalJob(run("e1"));
    Object.assign(ev("e1"), { deletedAt: new Date(), syncVersion: 2, googleSyncState: "PENDING" });
    await gcalJob(run("e1"));
    expect(liveGoogle(PUBLIC_CAL)).toHaveLength(0);
    expect(ev("e1")).toMatchObject({ googleSyncState: "NOT_APPLICABLE", googleEventId: null });
  });

  it("never puts an INTERNAL event on the public calendar", async () => {
    store.events.set("e_int", event("e_int", { visibility: "INTERNAL", conferenceUrl: "https://meet.google.com/a" }));
    await gcalJob(run("e_int"));
    expect(google.calls).toEqual([]);
    expect(ev("e_int")).toMatchObject({ googleSyncState: "NOT_APPLICABLE", googleEventId: null });
  });

  it("a visibility flip to INTERNAL removes the public mirror (no internal calendar)", async () => {
    store.events.set("e1", event("e1"));
    await gcalJob(run("e1"));
    Object.assign(ev("e1"), { visibility: "INTERNAL", syncVersion: 2 });
    await gcalJob(run("e1"));
    expect(liveGoogle(PUBLIC_CAL)).toHaveLength(0);
    expect(ev("e1")).toMatchObject({ googleSyncState: "NOT_APPLICABLE", googleEventId: null });
  });

  it("a visibility flip moves the event between the public and internal calendars", async () => {
    store.integrations[0].config = { publicCalendarId: PUBLIC_CAL, internalCalendarId: INTERNAL_CAL };
    store.events.set("e1", event("e1", { conferenceUrl: "https://meet.google.com/abc" }));
    await gcalJob(run("e1"));
    expect(JSON.stringify(liveGoogle(PUBLIC_CAL))).not.toContain("meet.google.com");
    Object.assign(ev("e1"), { visibility: "INTERNAL", syncVersion: 2 });
    await gcalJob(run("e1"));
    expect(liveGoogle(PUBLIC_CAL)).toHaveLength(0);
    expect(liveGoogle(INTERNAL_CAL)).toHaveLength(1);
    expect(String(liveGoogle(INTERNAL_CAL)[0].description)).toContain("Join: https://meet.google.com/abc");
    expect(ev("e1")).toMatchObject({ googleSyncState: "SYNCED", googleCalendarId: INTERNAL_CAL });
    // And back.
    Object.assign(ev("e1"), { visibility: "PUBLIC", syncVersion: 3 });
    await gcalJob(run("e1"));
    expect(liveGoogle(INTERNAL_CAL)).toHaveLength(0);
    expect(liveGoogle(PUBLIC_CAL)).toHaveLength(1);
  });

  it("compare-and-set: a stale worker records the linkage but not SYNCED; the re-run wins", async () => {
    store.events.set("e1", event("e1"));
    google.hook = (method) => {
      if (method === "POST") {
        // A save lands while the insert is in flight.
        Object.assign(ev("e1"), { title: "Renamed mid-flight", syncVersion: 2 });
      }
    };
    await gcalJob(run("e1"));
    expect(ev("e1")).toMatchObject({ googleSyncState: "PENDING", googleEventId: googleEventId(ORG, "e1") });
    google.hook = null;
    await gcalJob(run("e1"));
    expect(ev("e1")).toMatchObject({ googleSyncState: "SYNCED" });
    expect(liveGoogle(PUBLIC_CAL).map((e) => e.summary)).toEqual(["Renamed mid-flight"]);
  });

  it("the delete-before-insert race leaves nothing behind in Google", async () => {
    store.events.set("e1", event("e1"));
    google.hook = (method) => {
      if (method === "POST") Object.assign(ev("e1"), { deletedAt: new Date(), syncVersion: 2 });
    };
    await gcalJob(run("e1")); // inserted, but the event was deleted meanwhile
    google.hook = null;
    await gcalJob(run("e1")); // the coalesced re-run
    expect(liveGoogle(PUBLIC_CAL)).toHaveLength(0);
    expect(ev("e1")).toMatchObject({ googleSyncState: "NOT_APPLICABLE", googleEventId: null });
  });

  it("retries server errors with a sanitized error, then FAILED on the last attempt", async () => {
    store.events.set("e1", event("e1"));
    google.inject.push({ method: "POST", status: 503, reason: "backendError" });
    await expect(gcalJob(run("e1", 1))).rejects.toThrow(/503/);
    expect(ev("e1")).toMatchObject({ googleSyncState: "PENDING", googleSyncAttempts: 1 });
    expect(String(ev("e1").googleSyncError)).not.toContain("ya29");
    google.inject.push({ method: "POST", status: 500 });
    await expect(gcalJob(run("e1", 8))).rejects.toThrow();
    expect(ev("e1")).toMatchObject({ googleSyncState: "FAILED", googleSyncAttempts: 8 });
  });

  it("fails permanently on a 400", async () => {
    store.events.set("e1", event("e1"));
    google.inject.push({ method: "POST", status: 400, reason: "invalid" });
    await expect(gcalJob(run("e1"))).rejects.toBeInstanceOf(PermanentJobError);
    expect(ev("e1")).toMatchObject({ googleSyncState: "FAILED" });
  });

  it("does nothing while Google is disconnected, keeping the mirror's ids", async () => {
    store.integrations[0].status = "DISCONNECTED";
    store.events.set("e1", event("e1", { googleCalendarId: PUBLIC_CAL, googleEventId: "keep" }));
    await gcalJob(run("e1"));
    expect(google.calls).toEqual([]);
    expect(ev("e1")).toMatchObject({ googleSyncState: "NOT_APPLICABLE", googleEventId: "keep" });
  });
});

describe("invalid_grant", () => {
  it("sets NEEDS_REAUTH and alerts owners and admins once per streak", async () => {
    store.events.set("e1", event("e1"));
    store.events.set("e2", event("e2"));
    syncDeps.getAccessToken = vi.fn(async () => {
      throw new GoogleReauthError();
    });
    const first = await gcalJob(run("e1"));
    expect(first).toMatchObject({ status: "CANCELLED" });
    expect(store.integrations[0]).toMatchObject({ status: "NEEDS_REAUTH" });
    expect(store.notifications.map((n) => n.userId).sort()).toEqual(["u_admin", "u_owner"]);
    expect(store.notifications[0]).toMatchObject({ type: "INTEGRATION_ERROR", linkUrl: "/app/claude-builders-club/settings/integrations" });
    expect(store.jobs.filter((j) => j.kind === "notify-email")).toHaveLength(2);
    expect(ev("e1")).toMatchObject({ googleSyncState: "FAILED" });

    const second = await gcalJob(run("e2"));
    expect(second).toMatchObject({ status: "CANCELLED" });
    expect(store.notifications).toHaveLength(2); // no second alert
    expect(ev("e2")).toMatchObject({ googleSyncState: "FAILED" });
  });

  it("token refresh maps invalid_grant, caches access tokens and needs the platform client", async () => {
    process.env.GOOGLE_CALENDAR_CLIENT_ID = "client-id";
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "client-secret";
    try {
      expect(await getAccessToken(ORG)).toBe("ya29.test-token");
      expect(await getAccessToken(ORG)).toBe("ya29.test-token");
      expect(google.tokenCalls).toBe(1);
      clearAllAccessTokens();
      google.token = { status: 400, body: { error: "invalid_grant", error_description: "Token has been expired or revoked." } };
      await expect(getAccessToken(ORG)).rejects.toBeInstanceOf(GoogleReauthError);
      secrets.delete(`${ORG}:REFRESH_TOKEN`);
      await expect(getAccessToken(ORG)).rejects.toBeInstanceOf(GoogleReauthError);
      delete process.env.GOOGLE_CALENDAR_CLIENT_ID;
      await expect(getAccessToken(ORG)).rejects.toBeInstanceOf(GoogleNotConfiguredError);
    } finally {
      delete process.env.GOOGLE_CALENDAR_CLIENT_ID;
      delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
    }
  });
});

describe("the job-runner contract", () => {
  it("the Google client refuses to run inside a transaction", async () => {
    const client = createCalendarClient({ accessToken: "ya29.x" });
    await expect(
      withSystemOrgTx(ORG, async () => client.insertEvent(PUBLIC_CAL, { summary: "x" } as never)),
    ).rejects.toBeInstanceOf(NetworkInTransactionError);
    await expect(withSystemOrgTx(ORG, async () => getAccessToken(ORG))).rejects.toBeInstanceOf(
      NetworkInTransactionError,
    );
    expect(google.calls).toEqual([]);
  });

  it("pushToGoogle is pure network: it works with no database at all", async () => {
    const client = createCalendarClient({ accessToken: "ya29.x" });
    const outcome = await pushToGoogle(client, event("e9") as never, { target: PUBLIC_CAL, timeZone: "UTC" });
    expect(outcome).toMatchObject({ kind: "mirrored", link: { calendarId: PUBLIC_CAL } });
  });

  it("registers handlers for gcal, site-rebuild, google-import and google-revoke", () => {
    expect(implementedKinds()).toEqual(
      expect.arrayContaining(["gcal", "site-rebuild", "google-import", "google-revoke"]),
    );
  });
});

describe("the event service feeds the worker", () => {
  it("a save coalesces into one gcal job per event and marks it PENDING", async () => {
    store.events.set("e1", event("e1", { googleSyncState: "SYNCED", googleCalendarId: PUBLIC_CAL, googleEventId: "g" }));
    await withSystemOrgTx(ORG, { userId: "u_admin" }, async (ctx) => {
      const svc = { ...ctx, organizationId: ORG, userId: "u_admin" };
      await updateEvent(svc, "e1", { title: "A" });
      await updateEvent(svc, "e1", { title: "B" });
    });
    // enqueueJob merges same-key jobs in SQL; here both calls carry the same key.
    expect(new Set(store.jobs.filter((j) => j.kind === "gcal").map((j) => j.key))).toEqual(new Set(["e1"]));
    expect(ev("e1")).toMatchObject({ googleSyncState: "PENDING", syncVersion: 3 });
    // A PUBLIC change also queues the (debounced) site rebuild.
    expect(store.jobs.some((j) => j.kind === "site-rebuild")).toBe(true);
  });

  it("deleting a mirrored event while Google is disconnected leaves it PENDING for Sync now", async () => {
    store.integrations[0].status = "DISCONNECTED";
    store.events.set("e1", event("e1", { googleSyncState: "SYNCED", googleCalendarId: PUBLIC_CAL, googleEventId: "g" }));
    await withSystemOrgTx(ORG, { userId: "u_admin" }, async (ctx) => {
      await deleteEvent({ ...ctx, organizationId: ORG, userId: "u_admin" }, "e1");
    });
    expect(store.jobs.filter((j) => j.kind === "gcal")).toHaveLength(0);
    expect(ev("e1")).toMatchObject({ googleSyncState: "PENDING" });
  });
});

describe("google-import", () => {
  function importRun(mode: "dry-run" | "apply") {
    return {
      id: "job_import",
      kind: "google-import",
      organizationId: ORG,
      payload: { integrationId: "int_google", mode },
      dedupeKey: `google-import:int_google:${mode}`,
      attempt: 1,
      maxAttempts: 8,
      signal: new AbortController().signal,
      deadline: Date.now() + 240_000,
    };
  }

  function seedGoogle() {
    const put = (id: string, summary: string, start: string, extra: Record<string, unknown> = {}) =>
      cal(PUBLIC_CAL).set(id, {
        id,
        status: "confirmed",
        etag: '"1"',
        summary,
        start: { dateTime: start },
        end: { dateTime: new Date(new Date(start).getTime() + 90 * 60 * 1000).toISOString() },
        description: "https://lu.ma/x\nCome build.",
        htmlLink: `https://www.google.com/calendar/event?eid=${id}`,
        ...extra,
      });
    const soon = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 13) + ":00:00.000Z";
    put("g_w1", "Workshop 1: Prompting Fundamentals", soon(3));
    put("g_new", "Guest talk: Evals", soon(10));
    put("g_amb", "Info Session", soon(5));
    // A workshop the website sync already created in the suite.
    store.events.set(
      "e_w1",
      event("e_w1", {
        title: "Workshop 1 - Prompting Fundamentals",
        startsAt: new Date(soon(3)),
        endsAt: new Date(new Date(soon(3)).getTime() + 90 * 60 * 1000),
        visibility: "INTERNAL",
        googleSyncState: "NOT_APPLICABLE",
      }),
    );
    // Two suite copies of the info session: ambiguous.
    for (const [id, offset] of [["e_i1", 0], ["e_i2", 30]] as const) {
      const start = new Date(new Date(soon(5)).getTime() + offset * 60 * 1000);
      store.events.set(id, event(id, { title: "Info session", startsAt: start, endsAt: start, googleSyncState: "NOT_APPLICABLE" }));
    }
  }

  it("dry run reports N linked, M new, K ambiguous without writing events", async () => {
    seedGoogle();
    const before = store.events.size;
    await googleImportJob(importRun("dry-run"));
    expect(store.events.size).toBe(before);
    expect((store.integrations[0].config as { import: unknown }).import).toMatchObject({
      mode: "dry-run",
      status: "done",
      linked: 1,
      created: 1,
      ambiguous: 1,
      unchanged: 0,
    });
    expect(google.calls.every((c) => c.startsWith("GET"))).toBe(true);
  });

  it("apply links the website-synced workshop once, creates the rest, and a re-run is a no-op", async () => {
    seedGoogle();
    await googleImportJob(importRun("apply"));
    const all = [...store.events.values()];
    const workshops = all.filter((e) => /Workshop 1/.test(String(e.title)));
    expect(workshops).toHaveLength(1);
    expect(ev("e_w1")).toMatchObject({ googleEventId: "g_w1", googleCalendarId: PUBLIC_CAL, visibility: "PUBLIC" });
    const created = all.find((e) => e.title === "Guest talk: Evals");
    expect(created).toMatchObject({
      visibility: "PUBLIC",
      googleEventId: "g_new",
      googleSyncState: "SYNCED",
      rsvpUrl: "https://lu.ma/x",
      description: "Come build.",
      createdById: "u_admin",
      needsReview: false,
    });
    expect(all.find((e) => e.googleEventId === "g_amb")).toMatchObject({ needsReview: true });
    expect(store.linkLogs.map((l) => l.method).sort()).toEqual(["EXACT", "EXACT", "MATCHED"]);
    // The linked suite event is pushed back (suite wins); the created ones are not.
    const gcal = store.jobs.filter((j) => j.kind === "gcal").map((j) => j.key);
    expect(gcal).toContain("e_w1");
    expect(gcal).not.toContain(created!.id);

    const count = store.events.size;
    await googleImportJob(importRun("apply"));
    expect(store.events.size).toBe(count);
    expect((store.integrations[0].config as { import: { unchanged: number } }).import).toMatchObject({
      unchanged: 3,
      linked: 0,
      created: 0,
      ambiguous: 0,
    });
  });
});

describe("google-revoke", () => {
  function revokeRun() {
    return {
      id: "job_revoke",
      kind: "google-revoke",
      organizationId: ORG,
      payload: { integrationId: "int_google" },
      dedupeKey: "google-revoke:int_google",
      attempt: 1,
      maxAttempts: 8,
      signal: new AbortController().signal,
      deadline: Date.now() + 20_000,
    };
  }

  it("revokes the grant after Disconnect and settles pending mirrors", async () => {
    store.integrations[0].status = "DISCONNECTED";
    store.events.set("e1", event("e1", { googleSyncState: "PENDING" }));
    await googleRevokeJob(revokeRun());
    expect(google.tokenCalls).toBe(1); // the revoke POST
    expect(ev("e1").googleSyncState).toBe("NOT_APPLICABLE");
    expect(store.audits).toContain("integration.google_revoked");
  });

  it("never revokes a grant the org reconnected with", async () => {
    await googleRevokeJob(revokeRun());
    expect(google.tokenCalls).toBe(0);
  });
});

describe("site-rebuild", () => {
  function rebuildRun() {
    return {
      id: "job_rebuild",
      kind: "site-rebuild",
      organizationId: ORG,
      payload: {},
      dedupeKey: `site-rebuild:${ORG}`,
      attempt: 1,
      maxAttempts: 8,
      signal: new AbortController().signal,
      deadline: Date.now() + 30_000,
    };
  }

  it("POSTs the org's Netlify build hook once", async () => {
    secrets.set(`${ORG}:HOOK_URL`, "https://api.netlify.com/build_hooks/5f1a2b3c4d5e6f7a8b9c0d1e");
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await siteRebuildJob(rebuildRun());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toMatch(/^https:\/\/api\.netlify\.com\/build_hooks\/5f1a2b3c4d5e6f7a8b9c0d1e\?trigger_title=/);
    expect(init.method).toBe("POST");
  });

  it("marks a deleted hook ERROR and stops", async () => {
    secrets.set(`${ORG}:HOOK_URL`, "https://api.netlify.com/build_hooks/5f1a2b3c4d5e6f7a8b9c0d1e");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    await expect(siteRebuildJob(rebuildRun())).rejects.toBeInstanceOf(PermanentJobError);
    expect(store.integrations[1]).toMatchObject({ status: "ERROR" });
  });

  it("retries Netlify outages", async () => {
    secrets.set(`${ORG}:HOOK_URL`, "https://api.netlify.com/build_hooks/5f1a2b3c4d5e6f7a8b9c0d1e");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 502 })));
    await expect(siteRebuildJob(rebuildRun())).rejects.not.toBeInstanceOf(PermanentJobError);
  });

  it("only accepts Netlify build hook URLs", async () => {
    expect(parseBuildHookUrl("https://api.netlify.com/build_hooks/abc123def456")).not.toBeNull();
    expect(parseBuildHookUrl("http://api.netlify.com/build_hooks/abc123def456")).toBeNull();
    expect(parseBuildHookUrl("https://169.254.169.254/latest/meta-data")).toBeNull();
    expect(parseBuildHookUrl("https://api.netlify.com.evil.example/build_hooks/abc123def456")).toBeNull();
    secrets.set(`${ORG}:HOOK_URL`, "https://example.com/hook");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(siteRebuildJob(rebuildRun())).rejects.toBeInstanceOf(PermanentJobError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing without a hook", async () => {
    store.integrations.splice(1, 1);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await siteRebuildJob(rebuildRun());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
