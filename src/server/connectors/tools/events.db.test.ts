// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * list_events and get_event against the real roles and policies
 * (src/test/connector-fixture.ts): times in the member's own zone, RSVP
 * counts and the member's answer, linked notes as the notes rules allow,
 * and the denials every tool has.
 */

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { NotFoundError } from "@/lib/auth/errors";
import { disconnectAll } from "@/server/db/clients";
import { ConnectorRefusedError } from "@/server/db/context";
import { asJson, setUpConnectorFixture, type ConnectorFixture } from "@/test/connector-fixture";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { getEvent, listEvents } from "./events";
import { itemId } from "./ids";
import { SectionHiddenError } from "./space";

const DAY = 86_400_000;
const now = new Date();
let fx: ConnectorFixture | null = null;
const ids = { gala: "", past: "", retreat: "", chess: "", paused: "", minutes: "", diary: "" };
/** The gala's start, on the hour a week from now. */
const galaStart = new Date(Math.ceil((now.getTime() + 7 * DAY) / 3_600_000) * 3_600_000);
/** The retreat: two whole days, starting at UTC midnight ten days from now. */
const retreatStart = new Date(Math.floor((now.getTime() + 10 * DAY) / DAY) * DAY);

beforeAll(async () => {
  fx = await setUpConnectorFixture("tool-events");
  if (!fx) return;
  const { alice, bob, club, other, pausedId, tag } = fx;
  const event = async (
    organizationId: string,
    data: Record<string, unknown> & { title: string; startsAt: Date; endsAt: Date },
  ) =>
    (
      await ownerDb.event.create({
        data: { organizationId, createdById: bob.id, ...data },
        select: { id: true },
      })
    ).id;
  ids.gala = await event(club.id, {
    title: `Spring gala ${tag}`,
    description: "Dress up.",
    location: "Curry Student Center",
    startsAt: galaStart,
    endsAt: new Date(galaStart.getTime() + 3 * 3_600_000),
    hostUserId: bob.id,
    kind: "SOCIAL",
    conferenceUrl: "https://meet.example/gala",
  });
  ids.past = await event(club.id, {
    title: `Kickoff ${tag}`,
    startsAt: new Date(now.getTime() - 2 * DAY),
    endsAt: new Date(now.getTime() - 2 * DAY + 3_600_000),
  });
  ids.retreat = await event(club.id, {
    title: `Retreat ${tag}`,
    allDay: true,
    startsAt: retreatStart,
    endsAt: new Date(retreatStart.getTime() + 2 * DAY),
  });
  ids.chess = await event(other.id, {
    title: `Chess night ${tag}`,
    startsAt: galaStart,
    endsAt: new Date(galaStart.getTime() + 3_600_000),
  });
  ids.paused = await event(pausedId, {
    title: `Paused social ${tag}`,
    startsAt: galaStart,
    endsAt: new Date(galaStart.getTime() + 3_600_000),
    createdById: alice.id,
  });
  await ownerDb.eventAttendee.createMany({
    data: [
      { organizationId: club.id, eventId: ids.gala, userId: alice.id, rsvp: "YES" },
      { organizationId: club.id, eventId: ids.gala, userId: bob.id, rsvp: "MAYBE" },
    ],
  });
  const note = async (title: string, visibility: "PRIVATE" | "ORGANIZATION") =>
    (
      await ownerDb.note.create({
        data: {
          organizationId: club.id,
          title,
          contentJson: {},
          contentText: "",
          visibility,
          eventId: ids.gala,
          authorId: bob.id,
          updatedById: bob.id,
        },
        select: { id: true },
      })
    ).id;
  ids.minutes = await note(`Gala plan ${tag}`, "ORGANIZATION");
  ids.diary = await note(`Gala worries ${tag}`, "PRIVATE");
});

afterAll(async () => {
  await fx?.cleanup();
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("list_events", () => {
  it("lists what hasn't ended, in time order, with RSVP counts and the member's own answer", async () => {
    if (!fx) return;
    const { alice, club } = fx;
    const res = await listEvents(await fx.session(alice), { space: club.id }, now);
    expect(res.timeZone).toBe("UTC");
    expect(res.events.map((e) => e.id)).toEqual([
      itemId("event", club.id, ids.gala),
      itemId("event", club.id, ids.retreat),
    ]);
    expect(res.events[0]).toMatchObject({
      title: `Spring gala ${fx.tag}`,
      starts: galaStart.toISOString().replace(".000Z", "Z"),
      allDay: false,
      location: "Curry Student Center",
      kind: "social",
      yourRsvp: "going",
      rsvps: { going: 1, maybe: 1, notGoing: 0, noAnswer: 0 },
      url: `http://localhost:3000/app/${club.slug}/calendar/${ids.gala}`,
    });
    const day = retreatStart.toISOString().slice(0, 10);
    expect(res.events[1]).toMatchObject({
      allDay: true,
      starts: day,
      ends: new Date(retreatStart.getTime() + DAY).toISOString().slice(0, 10),
      yourRsvp: null,
      rsvps: { going: 0, maybe: 0, notGoing: 0, noAnswer: 0 },
    });
  });

  it("reads a range, and gives times in the member's own zone", async () => {
    if (!fx) return;
    const { alice, club } = fx;
    const session = await fx.session(alice);
    const from = new Date(now.getTime() - 3 * DAY).toISOString().slice(0, 10);
    const to = new Date(galaStart.getTime() - DAY).toISOString().slice(0, 10);
    const range = await listEvents(session, { space: club.id, from, to }, now);
    expect(range.events.map((e) => e.title)).toEqual([`Kickoff ${fx.tag}`]);

    await ownerDb.user.update({ where: { id: alice.id }, data: { timezone: "America/New_York" } });
    try {
      const zoned = await listEvents(session, { space: club.id }, now);
      expect(zoned.timeZone).toBe("America/New_York");
      expect(zoned.events[0]?.starts).toMatch(/-0[45]:00$/);
      expect(new Date(zoned.events[0]!.starts).getTime()).toBe(galaStart.getTime());
    } finally {
      await ownerDb.user.update({ where: { id: alice.id }, data: { timezone: null } });
    }
  });

  it("reads a paused club's calendar, and refuses another org, the club switch, another scope and a hidden Calendar", async () => {
    if (!fx) return;
    const { alice, bob, club, other, pausedId, personalId } = fx;
    const session = await fx.session(alice);
    expect(
      (await listEvents(session, { space: pausedId }, now)).events.map((e) => e.title),
    ).toEqual([`Paused social ${fx.tag}`]);
    await expect(listEvents(session, { space: other.id })).rejects.toBeInstanceOf(NotFoundError);
    await fx.switchedOff(club.id, () =>
      expect(listEvents(session, { space: club.id })).rejects.toBeInstanceOf(ConnectorRefusedError),
    );
    await expect(
      listEvents(await fx.session(alice, { organizationId: personalId }), { space: club.id }),
    ).rejects.toMatchObject({ reason: "scope" });
    await fx.hiding(club.id, ["calendar"], async () => {
      await expect(listEvents(session, { space: club.id })).rejects.toBeInstanceOf(
        SectionHiddenError,
      );
      expect(
        (await listEvents(await fx!.session(bob), { space: club.id }, now)).events,
      ).toHaveLength(2);
    });
  });
});

describe("get_event", () => {
  it("gets the host, answers, call link and the linked notes the member may read", async () => {
    if (!fx) return;
    const { alice, bob, club } = fx;
    const event = await getEvent(
      await fx.session(alice),
      { id: itemId("event", club.id, ids.gala) },
      now,
    );
    expect(event).toMatchObject({
      title: `Spring gala ${fx.tag}`,
      description: "Dress up.",
      host: bob.name,
      meetingLink: "https://meet.example/gala",
      attendeeCount: 2,
      yourRsvp: "going",
      notes: [{ id: itemId("note", club.id, ids.minutes), title: `Gala plan ${fx.tag}` }],
    });
    expect(event.attendees).toEqual(
      expect.arrayContaining([
        { person: { id: itemId("person", club.id, alice.id), name: alice.name }, rsvp: "going" },
        { person: { id: itemId("person", club.id, bob.id), name: bob.name }, rsvp: "maybe" },
      ]),
    );
    // Linked notes stay out while the club hides Files from members.
    await fx.hiding(club.id, ["notes"], async () => {
      const id = itemId("event", club.id, ids.gala);
      expect((await getEvent(await fx!.session(alice), { id }, now)).notes).toEqual([]);
      expect((await getEvent(await fx!.session(bob), { id }, now)).notes).toHaveLength(2);
    });
  });

  it("answers another org's event and a forged id as not found", async () => {
    if (!fx) return;
    const { alice, club, other } = fx;
    const session = await fx.session(alice);
    await expect(
      getEvent(session, { id: itemId("event", other.id, ids.chess) }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      getEvent(session, { id: itemId("event", club.id, ids.chess) }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("through the MCP server", () => {
  it("returns list_events and get_event within their output schemas", async () => {
    if (!fx) return;
    const session = await fx.session(fx.alice);
    const list = { space: fx.club.id };
    expect(await fx.call(session, "list_events", list)).toEqual(
      asJson(await listEvents(session, list)),
    );
    const id = itemId("event", fx.club.id, ids.gala);
    expect(await fx.call(session, "get_event", { id })).toEqual(
      asJson(await getEvent(session, { id })),
    );
    // A time without an offset reads in the member's zone (UTC here).
    const local = galaStart.toISOString().slice(0, 16);
    const from = await fx.call(session, "list_events", { space: fx.club.id, from: local });
    expect((from.events as { title: string }[]).map((e) => e.title)[0]).toBe(
      `Spring gala ${fx.tag}`,
    );
  });
});
