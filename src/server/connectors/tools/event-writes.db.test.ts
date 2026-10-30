// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * rsvp_to_event against the real roles and policies
 * (src/test/connector-fixture.ts): the member's own answer, replacing the
 * earlier one, and audited; an event they aren't invited to, and one in
 * another club. The wrapper's own refusals are in write.db.test.ts.
 */

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { NotFoundError } from "@/lib/auth/errors";
import { disconnectAll } from "@/server/db/clients";
import { NOT_INVITED } from "@/server/events/rsvp";
import { asJson, setUpConnectorFixture, type ConnectorFixture } from "@/test/connector-fixture";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { rsvpToEventTool } from "./event-writes";
import { itemId } from "./ids";
import { WriteRefusedError } from "./write";

let fx: ConnectorFixture | null = null;
const ids = { gala: "", board: "", chess: "" };
const start = new Date(Date.now() + 7 * 86_400_000);
const end = new Date(start.getTime() + 3_600_000);

beforeAll(async () => {
  fx = await setUpConnectorFixture("tool-event-writes");
  if (!fx) return;
  const { alice, bob, club, other, tag } = fx;
  const event = async (organizationId: string, title: string) =>
    (
      await ownerDb.event.create({
        data: { organizationId, title, startsAt: start, endsAt: end, createdById: bob.id },
        select: { id: true },
      })
    ).id;
  ids.gala = await event(club.id, `Spring gala ${tag}`);
  ids.board = await event(club.id, `Board meeting ${tag}`);
  ids.chess = await event(other.id, `Chess night ${tag}`);
  await ownerDb.eventAttendee.createMany({
    data: [
      { organizationId: club.id, eventId: ids.gala, userId: alice.id },
      { organizationId: club.id, eventId: ids.gala, userId: bob.id, rsvp: "YES" },
      { organizationId: club.id, eventId: ids.board, userId: bob.id },
    ],
  });
});

afterAll(async () => {
  await fx?.cleanup();
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("rsvp_to_event", () => {
  it("answers the member's own invitation, replaces it, and audits each answer", async () => {
    if (!fx) return;
    const { alice, bob, club, tag } = fx;
    const session = await fx.session(alice, { access: "WRITE" });
    const id = itemId("event", club.id, ids.gala);
    const going = await rsvpToEventTool(session, { id, rsvp: "going" });
    expect(going).toMatchObject({
      space: { id: club.id, name: `Robotics ${tag}` },
      event: {
        id,
        title: `Spring gala ${tag}`,
        yourRsvp: "going",
        rsvps: { going: 2, maybe: 0, notGoing: 0, noAnswer: 0 },
        url: `http://localhost:3000/app/${club.slug}/calendar/${ids.gala}`,
      },
    });
    const maybe = await rsvpToEventTool(session, { id, rsvp: "maybe" });
    expect(maybe.event).toMatchObject({
      yourRsvp: "maybe",
      rsvps: { going: 1, maybe: 1, notGoing: 0, noAnswer: 0 },
    });
    const rows = await ownerDb.eventAttendee.findMany({
      where: { eventId: ids.gala },
      select: { userId: true, rsvp: true },
      orderBy: { userId: "asc" },
    });
    expect(rows).toEqual(
      [
        { userId: alice.id, rsvp: "MAYBE" },
        { userId: bob.id, rsvp: "YES" },
      ].sort((a, b) => a.userId.localeCompare(b.userId)),
    );
    expect(
      await ownerDb.orgAuditLog.findMany({
        where: { organizationId: club.id, action: "connector.rsvp_to_event" },
        select: { actorId: true, targetType: true, targetId: true },
      }),
    ).toEqual([
      { actorId: alice.id, targetType: "Event", targetId: ids.gala },
      { actorId: alice.id, targetType: "Event", targetId: ids.gala },
    ]);
  });

  it("refuses an event the member isn't invited to, and changes nobody's answer", async () => {
    if (!fx) return;
    const { alice, bob, club } = fx;
    const session = await fx.session(alice, { access: "WRITE" });
    await expect(
      rsvpToEventTool(session, { id: itemId("event", club.id, ids.board), rsvp: "going" }),
    ).rejects.toEqual(new WriteRefusedError(NOT_INVITED));
    const bobs = await ownerDb.eventAttendee.findUniqueOrThrow({
      where: { eventId_userId: { eventId: ids.board, userId: bob.id } },
      select: { rsvp: true },
    });
    expect(bobs.rsvp).toBe("PENDING");
  });

  it("answers another club's event, a forged id and a deleted event as not found", async () => {
    if (!fx) return;
    const { alice, club, other } = fx;
    const session = await fx.session(alice, { access: "WRITE" });
    for (const id of [
      itemId("event", other.id, ids.chess),
      itemId("event", club.id, ids.chess),
      itemId("task", club.id, ids.gala),
    ]) {
      await expect(rsvpToEventTool(session, { id, rsvp: "going" })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    }
    await ownerDb.event.update({ where: { id: ids.gala }, data: { deletedAt: new Date() } });
    try {
      await expect(
        rsvpToEventTool(session, { id: itemId("event", club.id, ids.gala), rsvp: "going" }),
      ).rejects.toBeInstanceOf(NotFoundError);
    } finally {
      await ownerDb.event.update({ where: { id: ids.gala }, data: { deletedAt: null } });
    }
  });

  it("returns its result within its output schema through the MCP server", async () => {
    if (!fx) return;
    const session = await fx.session(fx.alice, { access: "WRITE" });
    const id = itemId("event", fx.club.id, ids.gala);
    const wire = await fx.call(session, "rsvp_to_event", { id, rsvp: "not_going" });
    expect(wire).toEqual(asJson(await rsvpToEventTool(session, { id, rsvp: "not_going" })));
    expect(wire).toMatchObject({
      event: { id, yourRsvp: "not_going", rsvps: { going: 1, maybe: 0, notGoing: 1 } },
    });
  });
});
