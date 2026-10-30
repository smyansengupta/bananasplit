import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The guest page as a signed-out guest gets it: no account asked for, a
 * sign-in link for members only, and the members who answered shown by name
 * (never by id or email).
 */

const { db, getSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  db: {
    availabilityPoll: { findFirst: vi.fn() },
    membership: { count: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/auth/session", () => ({ getSession: getSessionMock }));
vi.mock("./poll-org", () => ({
  pollOrgId: async (id: string) => (id === "poll_1" ? "org_1" : null),
}));
vi.mock("./actions", () => ({ submitPollResponse: vi.fn() }));
vi.mock("@/app/app/[orgSlug]/calendar/polls/actions", () => ({ finalizePoll: vi.fn() }));
vi.mock("@/app/app/[orgSlug]/meetings/actions", () => ({
  meetingConnectionsAction: vi.fn(async () => []),
}));
vi.mock("@/server/db/context", () => ({
  withSystemOrgTx: async (_orgId: string, fn: (c: unknown) => unknown) => fn({ db }),
}));

const { default: PublicPollPage } = await import("./page");

const start = new Date("2030-01-07T14:00:00.000Z");
const end = new Date("2030-01-07T14:30:00.000Z");

function stored(overrides: Record<string, unknown> = {}) {
  return {
    id: "poll_1",
    organizationId: "org_1",
    createdById: "user_member_1",
    title: "Sponsor call",
    description: null,
    timezone: "America/New_York",
    durationMinutes: 30,
    closesAt: null,
    finalizedEventId: null,
    finalizedEvent: null,
    slots: [{ id: "slot_1", startsAt: start, endsAt: end }],
    responses: [
      {
        slotId: "slot_1",
        userId: "user_member_1",
        guestName: null,
        guestKeyHash: null,
        availability: "YES",
      },
      {
        slotId: "slot_1",
        userId: null,
        guestName: "Ada",
        guestKeyHash: "h".repeat(64),
        availability: "YES",
      },
    ],
    ...overrides,
  };
}

async function render(pollId = "poll_1") {
  const props = { params: Promise.resolve({ pollId }) } as unknown as PageProps<"/poll/[pollId]">;
  return renderToStaticMarkup(await PublicPollPage(props));
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue(null);
  db.availabilityPoll.findFirst.mockResolvedValue(stored());
  db.membership.count.mockResolvedValue(0);
  db.membership.findMany.mockResolvedValue([
    { user: { id: "user_member_1", name: "Alice Nguyen" } },
  ]);
});

describe("the public poll page", () => {
  it("asks a signed-out guest for nothing but a name, and offers members a sign-in", async () => {
    const html = await render();
    expect(html).toContain("No account needed");
    expect(html).toContain('id="guest-name"');
    expect(html).toContain(`href="/sign-in?callbackUrl=${encodeURIComponent("/poll/poll_1")}"`);
  });

  it("shows the members who answered by name, and nothing that identifies them further", async () => {
    const html = await render();
    expect(html).toContain("Alice Nguyen");
    expect(html).toContain("Ada");
    expect(html).not.toContain("user_member_1");
    expect(db.membership.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1", userId: { in: ["user_member_1"] } },
      select: { user: { select: { id: true, name: true } } },
    });
  });

  it("drops the guest note once the poll is closed", async () => {
    db.availabilityPoll.findFirst.mockResolvedValue(stored({ closesAt: new Date(0) }));
    expect(await render()).not.toContain("No account needed");
  });

  it("says so for a poll that doesn't exist", async () => {
    expect(await render("nope")).toContain("This poll isn");
  });
});
