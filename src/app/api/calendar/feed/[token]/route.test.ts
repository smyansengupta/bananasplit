// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { store } = vi.hoisted(() => ({
  store: {
    userByTokenHash: vi.fn(),
    orgsOf: vi.fn(),
    eventsIn: vi.fn(),
    txOrgs: [] as (string | null)[],
  },
}));

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn(), getSession: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: true }),
  rateLimitKey: (...parts: string[]) => parts.join(":"),
}));

const route = await import("./route");
const { hashIcsToken } = await import("@/lib/ics-token");
const { feedEventsWhereInOrg } = await import("@/lib/calendar-feed");

function call(token: string) {
  return route.GET(new Request(`http://localhost/api/calendar/feed/${token}`), {
    params: Promise.resolve({ token }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  route.feedReads.userByTokenHash = store.userByTokenHash;
  route.feedReads.orgsOf = store.orgsOf;
  route.feedReads.eventsIn = store.eventsIn;
  store.orgsOf.mockResolvedValue([]);
  store.eventsIn.mockResolvedValue([]);
});

describe("personal ICS feed (0A Fix 7)", () => {
  it("resolves the token by its sha256 hash only", async () => {
    store.userByTokenHash.mockResolvedValue(null);
    const response = await call("plain-token-1");
    expect(response.status).toBe(404);
    expect(store.userByTokenHash).toHaveBeenCalledWith(hashIcsToken("plain-token-1"));
    expect(store.orgsOf).not.toHaveBeenCalled();
  });

  it("reads only the orgs the user is still a member of, each with its own timezone", async () => {
    store.userByTokenHash.mockResolvedValue({ id: "u1", name: "U" });
    store.orgsOf.mockResolvedValue([
      { id: "org_ny", name: "NY club", timezone: "America/New_York", deletedAt: null },
      { id: "org_tokyo", name: "Tokyo club", timezone: "Asia/Tokyo", deletedAt: null },
    ]);
    store.eventsIn.mockImplementation(async (_u: string, org: { id: string; timezone: string }) => [
      {
        id: `e_${org.id}`,
        title: `All day in ${org.id}`,
        description: null,
        location: null,
        startsAt: org.id === "org_ny" ? new Date("2026-10-10T04:00:00Z") : new Date("2026-10-09T15:00:00Z"),
        endsAt: org.id === "org_ny" ? new Date("2026-10-11T04:00:00Z") : new Date("2026-10-10T15:00:00Z"),
        allDay: true,
        updatedAt: new Date("2026-09-01T00:00:00Z"),
        timeZone: org.timezone,
        sequence: 2,
      },
    ]);
    const response = await call("plain-token-2");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toMatch(/text\/calendar/);
    expect(store.eventsIn.mock.calls.map((c) => c[1].id)).toEqual(["org_ny", "org_tokyo"]);
    const ics = await response.text();
    // Both are Oct 10 in their own org's timezone.
    expect(ics.match(/DTSTART;VALUE=DATE:20261010/g)).toHaveLength(2);
    expect(ics).toContain("SEQUENCE:2");
  });

  it("filters to invitations in orgs the user still belongs to", () => {
    expect(feedEventsWhereInOrg("u1", "org_1")).toEqual({
      deletedAt: null,
      mergedIntoId: null,
      organizationId: "org_1",
      attendees: { some: { userId: "u1" } },
      organization: { deletedAt: null, memberships: { some: { userId: "u1" } } },
    });
  });
});
