import { describe, expect, it, vi } from "vitest";

/**
 * The Personal dashboard's shaping (shapePersonalHome): how each space's
 * reads are merged, labelled, sorted and cut. The reads themselves run
 * under RLS and are covered by home.db.test.ts.
 */

vi.mock("@/server/db/context", () => ({ withOrgTx: vi.fn(), withUserTx: vi.fn() }));
vi.mock("@/server/settings/invitations", () => ({ findPendingInvitationsForMe: vi.fn() }));

const { DUE_SOON_LIMIT, UPCOMING_LIMIT, profileGapsOf, shapePersonalHome } = await import("./home");
type Raw = Parameters<typeof shapePersonalHome>[0];
type Digest = NonNullable<Raw["spaces"][number]["digest"]>;
type Space = Raw["spaces"][number]["space"];

// 10:00 on Tuesday, Oct 13 in Chicago.
const NOW = new Date("2026-10-13T15:00:00Z");

const user: NonNullable<Raw["user"]> = {
  name: "Maya Patel",
  timezone: "America/Chicago",
  emailVerified: true,
  major: "Computer Science",
  gradYear: 2028,
  bio: "Hi",
  links: [],
  hasAvailability: true,
};

function space(over: Partial<Space> & Pick<Space, "id" | "name" | "slug" | "kind">): Space {
  return {
    logo: null,
    timezone: "America/New_York",
    plan: over.kind === "PERSONAL" ? "FREE" : "SOCIETY",
    trialEndsAt: null,
    role: "MEMBER",
    title: null,
    ...over,
  };
}

function digest(over: Partial<Digest> = {}): Digest {
  return {
    events: [],
    rsvps: new Map(),
    nextMeeting: null,
    dueTasks: [],
    openTasks: 0,
    unread: 0,
    waitingAvailability: [],
    waitingQuestions: [],
    ownPolls: [],
    hosted: [],
    ...over,
  };
}

const personal = space({
  id: "p1",
  name: "Maya's space",
  slug: "me-abc",
  kind: "PERSONAL",
  role: "OWNER",
});
const robotics = space({
  id: "c1",
  name: "Robotics",
  slug: "robotics",
  kind: "CLUB",
  title: "Treasurer",
});
const chess = space({
  id: "c2",
  name: "Chess",
  slug: "chess",
  kind: "CLUB",
  plan: "TRIAL",
  trialEndsAt: new Date("2026-10-01T00:00:00Z"),
});

function raw(over: Partial<Raw> = {}): Raw {
  return {
    user,
    spaces: [],
    moreClubs: 0,
    registrations: [],
    pendingInvites: [],
    ...over,
  };
}

const at = (iso: string) => new Date(iso);

describe("shapePersonalHome", () => {
  it("builds a card per club with its next meeting, open tasks, unread and pause", () => {
    const meeting = {
      id: "e1",
      title: "General meeting",
      startsAt: at("2026-10-15T23:00:00Z"),
      endsAt: at("2026-10-16T00:00:00Z"),
      allDay: false,
    };
    const data = shapePersonalHome(
      raw({
        spaces: [
          { space: personal, digest: digest() },
          { space: robotics, digest: digest({ nextMeeting: meeting, openTasks: 3, unread: 2 }) },
          { space: chess, digest: null },
        ],
        moreClubs: 2,
      }),
      NOW,
    );
    expect(data.clubs).toEqual([
      expect.objectContaining({
        id: "c1",
        title: "Treasurer",
        nextMeeting: meeting,
        openTasks: 3,
        unread: 2,
        paused: false,
        timeZone: "America/New_York",
      }),
      // A club that failed to load still has its card, just without numbers.
      expect.objectContaining({ id: "c2", nextMeeting: null, openTasks: 0, paused: true }),
    ]);
    expect(data.moreClubs).toBe(2);
    expect(data.firstName).toBe("Maya");
    expect(data.timeZone).toBe("America/Chicago");
    expect(data.todayKey).toBe("2026-10-13");
  });

  it("merges events across spaces, soonest first, labelled and linked to their space", () => {
    const ev = (id: string, iso: string) => ({
      id,
      title: id,
      startsAt: at(iso),
      endsAt: new Date(at(iso).getTime() + 3_600_000),
      allDay: false,
      kind: "OTHER" as const,
      location: null,
    });
    const data = shapePersonalHome(
      raw({
        spaces: [
          { space: personal, digest: digest({ events: [ev("dentist", "2026-10-14T15:00:00Z")] }) },
          {
            space: robotics,
            digest: digest({
              events: [ev("build", "2026-10-13T22:00:00Z"), ev("demo", "2026-10-20T22:00:00Z")],
              rsvps: new Map([["build", "YES"]]),
            }),
          },
        ],
      }),
      NOW,
    );
    expect(data.upcoming.map((e) => [e.id, e.space.name, e.rsvp, e.href])).toEqual([
      ["build", "Robotics", "YES", "/app/robotics/calendar/build"],
      ["dentist", "Personal", null, "/app/me-abc/calendar/dentist"],
      ["demo", "Robotics", null, "/app/robotics/calendar/demo"],
    ]);
  });

  it("cuts the merged lists to their limits", () => {
    const events = Array.from({ length: 8 }, (_, i) => ({
      id: `e${i}`,
      title: `Event ${i}`,
      startsAt: new Date(NOW.getTime() + (i + 1) * 3_600_000),
      endsAt: new Date(NOW.getTime() + (i + 2) * 3_600_000),
      allDay: false,
      kind: "OTHER" as const,
      location: null,
    }));
    const tasks = Array.from({ length: 8 }, (_, i) => ({
      id: `t${i}`,
      title: `Task ${i}`,
      status: "NOT_STARTED" as const,
      dueDate: at("2026-10-14T00:00:00Z"),
    }));
    const data = shapePersonalHome(
      raw({
        spaces: [
          { space: personal, digest: digest({ events, dueTasks: tasks }) },
          { space: robotics, digest: digest({ events, dueTasks: tasks }) },
        ],
      }),
      NOW,
    );
    expect(data.upcoming).toHaveLength(UPCOMING_LIMIT);
    expect(data.dueSoon).toHaveLength(DUE_SOON_LIMIT);
    expect(data.dueSoonTotal).toBe(16);
  });

  it("buckets due tasks in your own zone: overdue, today, soon", () => {
    const task = (id: string, key: string) => ({
      id,
      title: id,
      status: "IN_PROGRESS" as const,
      dueDate: at(`${key}T00:00:00Z`),
    });
    const data = shapePersonalHome(
      raw({
        spaces: [
          { space: personal, digest: digest({ dueTasks: [task("today", "2026-10-13")] }) },
          {
            space: robotics,
            digest: digest({
              dueTasks: [task("late", "2026-10-10"), task("friday", "2026-10-16")],
            }),
          },
        ],
      }),
      NOW,
    );
    expect(data.dueSoon.map((t) => [t.id, t.bucket, t.space.name, t.href])).toEqual([
      ["late", "overdue", "Robotics", "/app/robotics/tasks/late"],
      ["today", "today", "Personal", "/app/me-abc/tasks/today"],
      ["friday", "soon", "Robotics", "/app/robotics/tasks/friday"],
    ]);
  });

  it("lists polls waiting on you (closing soonest first) and your own with answers", () => {
    const data = shapePersonalHome(
      raw({
        spaces: [
          {
            space: personal,
            digest: digest({
              ownPolls: [{ id: "mine", title: "Study group", closesAt: null, respondents: 4 }],
            }),
          },
          {
            space: robotics,
            digest: digest({
              waitingAvailability: [{ id: "a1", title: "Kickoff time", closesAt: null }],
              waitingQuestions: [
                { id: "q1", question: "Pizza or tacos?", closesAt: at("2026-10-14T00:00:00Z") },
              ],
            }),
          },
        ],
      }),
      NOW,
    );
    expect(data.pollsWaiting.map((p) => [p.id, p.kind, p.title, p.href])).toEqual([
      ["q1", "question", "Pizza or tacos?", "/app/robotics/calendar/polls/q1"],
      ["a1", "availability", "Kickoff time", "/app/robotics/calendar/find-a-time/a1"],
    ]);
    expect(data.ownPolls).toEqual([
      expect.objectContaining({
        id: "mine",
        respondents: 4,
        href: "/app/me-abc/calendar/find-a-time/mine",
      }),
    ]);
  });

  it("turns sign-ups into ticket links and Personal pages into hosted pages", () => {
    const data = shapePersonalHome(
      raw({
        spaces: [
          {
            space: personal,
            digest: digest({
              hosted: [
                {
                  id: "party",
                  title: "Birthday",
                  startsAt: at("2026-10-17T23:00:00Z"),
                  endsAt: at("2026-10-18T03:00:00Z"),
                  allDay: false,
                  rsvpEnabled: true,
                  rsvpSlug: "bday1234",
                  rsvpCapacity: 20,
                  going: 7,
                  waitlist: 0,
                },
              ],
            }),
          },
        ],
        registrations: [
          {
            registrationId: "r1",
            status: "GOING",
            ticketCode: "abcdefghjkmn",
            eventId: "x",
            title: "Hack night",
            startsAt: at("2026-10-15T23:00:00Z"),
            endsAt: at("2026-10-16T02:00:00Z"),
            allDay: false,
            rsvpSlug: "hack2026",
            spaceKind: "CLUB",
            spaceName: "Code Club",
            spaceTimezone: "America/New_York",
          },
          {
            registrationId: "r2",
            status: "WAITLIST",
            ticketCode: "nmkjhgfedcba",
            eventId: "y",
            title: "Dinner",
            startsAt: at("2026-10-16T23:00:00Z"),
            endsAt: at("2026-10-17T01:00:00Z"),
            allDay: false,
            rsvpSlug: "dinner12",
            spaceKind: "PERSONAL",
            spaceName: "Sam's space",
            spaceTimezone: "UTC",
          },
        ],
      }),
      NOW,
    );
    expect(data.rsvps).toEqual([
      expect.objectContaining({
        status: "GOING",
        host: "Code Club",
        pageHref: "/e/hack2026",
        ticketHref: "/e/hack2026/t/abcdefghjkmn",
      }),
      // Someone's Personal page: no space name (it's theirs, not a club).
      expect.objectContaining({ status: "WAITLIST", host: null, pageHref: "/e/dinner12" }),
    ]);
    expect(data.hosting).toEqual([
      expect.objectContaining({
        id: "party",
        going: 7,
        capacity: 20,
        enabled: true,
        manageHref: "/app/me-abc/meetings/party/rsvp",
        pageHref: "/e/bday1234",
      }),
    ]);
  });
});

describe("profileGapsOf / Finish your profile", () => {
  it("is empty for a complete profile", () => {
    expect(profileGapsOf(user)).toEqual([]);
    expect(shapePersonalHome(raw(), NOW).finishProfileHref).toBeNull();
  });

  it("lists the skipped steps in order and links to the first", () => {
    const skipped = {
      ...user,
      major: null,
      gradYear: null,
      bio: "  ",
      links: [],
      hasAvailability: false,
    };
    expect(profileGapsOf(skipped)).toEqual(["school", "bio", "availability"]);
    const data = shapePersonalHome(raw({ user: { ...user, hasAvailability: false } }), NOW);
    expect(data.profileGaps).toEqual(["availability"]);
    expect(data.finishProfileHref).toBe("/onboarding/profile/availability");
  });

  it("counts links alone as a bio", () => {
    const links = [{ kind: "github", url: "https://github.com/maya" }];
    expect(profileGapsOf({ ...user, bio: null, links })).toEqual([]);
  });
});
