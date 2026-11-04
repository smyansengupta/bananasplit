// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/context", async () =>
  (await import("@/test/fake-context")).fakeContextModule(),
);
vi.mock("./token", () => ({
  getAccessToken: vi.fn(async () => "access-token"),
  clearAccessToken: vi.fn(),
  clearAllAccessTokens: vi.fn(),
  getRefreshToken: vi.fn(async () => "refresh-token"),
}));

import { ConferenceProvider } from "@/generated/prisma/enums";

import { clientFor, meetClient, teamsClient, zoomClient } from "./clients";
import { conferenceHttp } from "./oauth";
import { clearAccessToken } from "./token";
import { ConferenceApiError, ConferenceReauthError, type ConferenceDraft } from "./types";

const draft: ConferenceDraft = {
  title: "Exec sync",
  startsAt: new Date("2026-11-03T18:00:00.000Z"),
  endsAt: new Date("2026-11-03T19:00:00.000Z"),
  timeZone: "America/New_York",
  allDay: false,
};

const ctx = { orgId: "org_A" };

function reply(...bodies: Array<{ body: unknown; status?: number }>) {
  const spy = vi.spyOn(conferenceHttp, "fetch");
  for (const { body, status = 200 } of bodies) {
    // 204 is what Zoom's PATCH and Graph's DELETE answer, and a 204 Response
    // may not carry a body.
    const noBody = status === 204 || status === 304;
    spy.mockResolvedValueOnce(
      new Response(noBody ? null : JSON.stringify(body), {
        status,
        headers: noBody ? undefined : { "content-type": "application/json" },
      }),
    );
  }
  return spy;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("clientFor", () => {
  it("maps an event's provider to its client, and has none for NONE or OTHER", () => {
    expect(clientFor(ConferenceProvider.MEET)).toBe(meetClient);
    expect(clientFor(ConferenceProvider.ZOOM)).toBe(zoomClient);
    expect(clientFor(ConferenceProvider.TEAMS)).toBe(teamsClient);
    expect(clientFor(ConferenceProvider.NONE)).toBeNull();
    expect(clientFor(ConferenceProvider.OTHER)).toBeNull();
  });
});

describe("Google Meet", () => {
  it("creates a space and keeps its name and link", async () => {
    const spy = reply({
      body: { name: "spaces/abc123", meetingUri: "https://meet.google.com/abc-defg-hij" },
    });
    const meeting = await meetClient.create(draft, ctx);
    expect(meeting).toEqual({
      meetingId: "spaces/abc123",
      joinUrl: "https://meet.google.com/abc-defg-hij",
      hostUrl: null,
      passcode: null,
      dialIn: [],
    });
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe("https://meet.googleapis.com/v2/spaces");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer access-token");
  });

  it("refuses a join link that is not on meet.google.com", async () => {
    reply({ body: { name: "spaces/abc", meetingUri: "https://evil.example/abc" } });
    await expect(meetClient.create(draft, ctx)).rejects.toThrow(/will not store/);
  });

  it("moving a meeting reads the space back, since a space has no time of its own", async () => {
    const spy = reply({
      body: { name: "spaces/abc123", meetingUri: "https://meet.google.com/abc-defg-hij" },
    });
    const meeting = await meetClient.update("spaces/abc123", draft, ctx);
    expect(meeting.joinUrl).toBe("https://meet.google.com/abc-defg-hij");
    expect(spy.mock.calls[0]![0]).toBe("https://meet.googleapis.com/v2/spaces/abc123");
    expect(spy.mock.calls[0]![1].method).toBe("GET");
  });

  it("treats a space with nobody in it as already ended", async () => {
    reply({ body: { error: { code: 400, message: "FAILED_PRECONDITION" } }, status: 400 });
    await expect(meetClient.remove("spaces/abc", ctx)).resolves.toBeUndefined();
  });
});

describe("Zoom", () => {
  it("creates a scheduled meeting in the connected account, with its duration", async () => {
    const spy = reply({
      body: {
        id: 87654321,
        join_url: "https://us02web.zoom.us/j/87654321",
        start_url: "https://us02web.zoom.us/s/87654321?zak=x",
        password: "123456",
        settings: {
          global_dial_in_numbers: [{ country: "US", number: "+12025550000" }],
        },
      },
    });
    const meeting = await zoomClient.create(draft, ctx);
    expect(meeting).toEqual({
      meetingId: "87654321",
      joinUrl: "https://us02web.zoom.us/j/87654321",
      hostUrl: "https://us02web.zoom.us/s/87654321?zak=x",
      passcode: "123456",
      dialIn: [{ country: "US", number: "+12025550000", pin: null }],
    });
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe("https://api.zoom.us/v2/users/me/meetings");
    const sent = JSON.parse(String(init.body));
    expect(sent).toMatchObject({
      topic: "Exec sync",
      type: 2,
      start_time: "2026-11-03T18:00:00Z",
      duration: 60,
      timezone: "America/New_York",
    });
  });

  it("patches then reads back, because Zoom's update answers with no body", async () => {
    const spy = reply(
      { body: {}, status: 204 },
      { body: { id: 1, join_url: "https://zoom.us/j/1" } },
    );
    const meeting = await zoomClient.update("1", draft, ctx);
    expect(meeting.meetingId).toBe("1");
    expect(spy.mock.calls[0]![1].method).toBe("PATCH");
    expect(spy.mock.calls[1]![1].method).toBe("GET");
  });

  it("names the missing scope when Zoom answers 4700", async () => {
    reply({ body: { code: 4700, message: "Invalid access token, does not contain scopes" }, status: 400 });
    await expect(zoomClient.create(draft, ctx)).rejects.toThrow(/meeting:write:meeting/);
  });

  it("gives a meeting at least a quarter of an hour, and caps it at a day", async () => {
    const spy = reply({ body: { id: 1, join_url: "https://zoom.us/j/1" } });
    await zoomClient.create({ ...draft, endsAt: draft.startsAt }, ctx);
    expect(JSON.parse(String(spy.mock.calls[0]![1].body)).duration).toBe(15);

    spy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 1, join_url: "https://zoom.us/j/1" }), {
        headers: { "content-type": "application/json" },
      }),
    );
    await zoomClient.create(
      { ...draft, endsAt: new Date(draft.startsAt.getTime() + 5 * 86_400_000) },
      ctx,
    );
    expect(JSON.parse(String(spy.mock.calls[1]![1].body)).duration).toBe(1440);
  });

  it("drops a start_url that is not Zoom's, rather than storing it", async () => {
    reply({
      body: { id: 1, join_url: "https://zoom.us/j/1", start_url: "https://evil.example/s/1" },
    });
    const meeting = await zoomClient.create(draft, ctx);
    expect(meeting.hostUrl).toBeNull();
  });
});

describe("Microsoft Teams", () => {
  it("creates an online meeting with a start and an end", async () => {
    const spy = reply({
      body: {
        id: "MSo5YzI",
        joinWebUrl: "https://teams.microsoft.com/l/meetup-join/19%3ameeting",
        audioConferencing: { tollNumber: "+12025550001", conferenceId: "556677" },
      },
    });
    const meeting = await teamsClient.create(draft, ctx);
    expect(meeting).toEqual({
      meetingId: "MSo5YzI",
      joinUrl: "https://teams.microsoft.com/l/meetup-join/19%3ameeting",
      hostUrl: null,
      passcode: null,
      dialIn: [{ country: null, number: "+12025550001", pin: "556677" }],
    });
    const sent = JSON.parse(String(spy.mock.calls[0]![1].body));
    expect(sent).toMatchObject({
      subject: "Exec sync",
      startDateTime: "2026-11-03T18:00:00.000Z",
      endDateTime: "2026-11-03T19:00:00.000Z",
    });
  });

  it("deletes by id", async () => {
    const spy = reply({ body: {}, status: 204 });
    await teamsClient.remove("MSo5YzI", ctx);
    expect(spy.mock.calls[0]![0]).toBe(
      "https://graph.microsoft.com/v1.0/me/onlineMeetings/MSo5YzI",
    );
    expect(spy.mock.calls[0]![1].method).toBe("DELETE");
  });
});

describe("failures every provider shares", () => {
  it("a 401 drops the cached token and asks for a reconnect", async () => {
    reply({ body: { error: "unauthorized" }, status: 401 });
    await expect(zoomClient.create(draft, ctx)).rejects.toBeInstanceOf(ConferenceReauthError);
    expect(clearAccessToken).toHaveBeenCalledWith("org_A", "ZOOM");
  });

  it("a 500 is retryable and a 400 is not", async () => {
    reply({ body: { message: "boom" }, status: 500 });
    const server = await zoomClient.create(draft, ctx).catch((e: unknown) => e);
    expect(server).toBeInstanceOf(ConferenceApiError);
    expect((server as ConferenceApiError).retryable).toBe(true);

    reply({ body: { message: "bad request" }, status: 400 });
    const client = await zoomClient.create(draft, ctx).catch((e: unknown) => e);
    expect((client as ConferenceApiError).retryable).toBe(false);
  });

  it("a 429 is retryable, so a rate limit does not lose the meeting", async () => {
    reply({ body: { message: "too many" }, status: 429 });
    const error = await teamsClient.create(draft, ctx).catch((e: unknown) => e);
    expect((error as ConferenceApiError).retryable).toBe(true);
  });
});
