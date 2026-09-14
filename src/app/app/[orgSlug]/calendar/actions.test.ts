import { beforeEach, describe, expect, it, vi } from "vitest";

// createEvent/rsvpToEvent go through withOrgContext, which calls requireUser
// (from session.ts) cross-module — replace that binding rather than the real
// session.ts, which pulls in next-auth and fails to resolve under Vitest.
const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    membership: { findUnique: vi.fn(), count: vi.fn() },
    event: { create: vi.fn(), findFirst: vi.fn() },
    eventAttendee: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { Role, ConferenceProvider, RSVPStatus } = await import("@/generated/prisma/enums");
const { createEvent, rsvpToEvent } = await import("./actions");

const testUser = { id: "user_1", email: "member@example.edu", name: "Test User" };

const validInput = {
  title: "Board meeting",
  startsAt: "2026-01-05T18:00:00.000Z",
  endsAt: "2026-01-05T19:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue(testUser);
  prismaMock.membership.findUnique.mockResolvedValue({ role: Role.MEMBER });
  prismaMock.event.create.mockResolvedValue({
    id: "event_1",
    title: validInput.title,
    startsAt: new Date(validInput.startsAt),
    attendees: [],
  });
});

describe("createEvent — conference link validation (spec 4.3)", () => {
  it("rejects a Meet link that isn't on meet.google.com", async () => {
    const result = await createEvent("org_1", {
      ...validInput,
      conferenceProvider: ConferenceProvider.MEET,
      conferenceUrl: "https://zoom.us/j/123",
    });

    expect(result.error).toMatch(/meet\.google\.com/i);
    expect(prismaMock.event.create).not.toHaveBeenCalled();
  });

  it("rejects a non-https link", async () => {
    const result = await createEvent("org_1", {
      ...validInput,
      conferenceProvider: ConferenceProvider.OTHER,
      conferenceUrl: "http://example.com/meeting",
    });

    expect(result.error).toMatch(/https/i);
    expect(prismaMock.event.create).not.toHaveBeenCalled();
  });

  it("rejects a blank link when a provider other than None is selected", async () => {
    const result = await createEvent("org_1", {
      ...validInput,
      conferenceProvider: ConferenceProvider.ZOOM,
      conferenceUrl: "",
    });

    expect(result.error).toMatch(/paste a meeting link/i);
    expect(prismaMock.event.create).not.toHaveBeenCalled();
  });

  it("accepts any https link when the provider is Other", async () => {
    const result = await createEvent("org_1", {
      ...validInput,
      conferenceProvider: ConferenceProvider.OTHER,
      conferenceUrl: "https://example.com/room/42",
    });

    expect(result.error).toBeUndefined();
    expect(prismaMock.event.create).toHaveBeenCalledOnce();
  });

  it("accepts a valid zoom.us link for the Zoom provider", async () => {
    const result = await createEvent("org_1", {
      ...validInput,
      conferenceProvider: ConferenceProvider.ZOOM,
      conferenceUrl: "https://us02web.zoom.us/j/123456789",
    });

    expect(result.error).toBeUndefined();
    expect(prismaMock.event.create).toHaveBeenCalledOnce();
  });
});

describe("rsvpToEvent — non-attendees cannot RSVP (spec 4.2)", () => {
  it("rejects a member who isn't invited to the event", async () => {
    prismaMock.eventAttendee.findUnique.mockResolvedValue(null);

    const result = await rsvpToEvent("org_1", "event_1", RSVPStatus.YES);

    expect(result.error).toMatch(/aren't invited/i);
    expect(prismaMock.eventAttendee.update).not.toHaveBeenCalled();
  });

  it("lets an invited attendee update their own RSVP", async () => {
    prismaMock.eventAttendee.findUnique.mockResolvedValue({
      eventId: "event_1",
      userId: testUser.id,
      rsvp: RSVPStatus.PENDING,
    });

    const result = await rsvpToEvent("org_1", "event_1", RSVPStatus.YES);

    expect(result.error).toBeUndefined();
    expect(prismaMock.eventAttendee.update).toHaveBeenCalledOnce();
  });
});
