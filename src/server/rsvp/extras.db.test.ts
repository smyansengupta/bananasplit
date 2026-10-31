// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The RSVP page extras, against the real roles, policies and functions on
 * the local database: the bring list, invite links, payments, tickets, and
 * check-ins landing in a club's attendance. Throwaway users and orgs are removed in afterAll. Skipped when
 * the database is not reachable.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock, getSession: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgTx, withSystemOrgTx } from "@/server/db/context";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { setRegistrationCheckIn } from "./checkin";
import { loadRsvpPage } from "./page";
import {
  claimPayment,
  confirmPayment,
  registerGuest,
  RSVP_RULES_SELECT,
  saveRsvpItems,
  setItemClaim,
  setRegistrationStatus,
} from "./service";
import { isEventHost, loadTicket } from "./ticket";

const tag = randomBytes(4).toString("hex");
const clubId = `c_rsvpfree_${tag}`;
const otherClubId = `c_rsvpfree2_${tag}`;
const slugChars = "abcdefghjkmnpqrstuvwxyz23456789";
const randomSlug = () =>
  Array.from(randomBytes(8), (b) => slugChars[b % slugChars.length]).join("");
const DAY = 24 * 60 * 60 * 1000;

type U = { id: string; email: string; name: string };
let host: U;
let stranger: U;
let reachable = true;
const users: U[] = [];
const orgIds: string[] = [clubId, otherClubId];

async function makeUser(local: string): Promise<U> {
  const email = `${local}-${tag}@example.edu`;
  const row = await authDb.user.create({
    data: { email, name: `${local} Tester`, emailVerified: new Date(), onboardedAt: new Date() },
    select: { id: true, email: true, name: true },
  });
  const user = { id: row.id, email: row.email, name: row.name ?? local };
  users.push(user);
  return user;
}

async function makeEvent(
  organizationId: string,
  options: { capacity?: number | null; cost?: number | null } = {},
) {
  const slug = randomSlug();
  const end = new Date(Date.now() + 3 * DAY);
  const event = await ownerDb.event.create({
    data: {
      organizationId,
      title: "Pizza night",
      startsAt: new Date(end.getTime() - 2 * 60 * 60 * 1000),
      endsAt: end,
      location: "Curry 342",
      createdById: host.id,
      rsvpEnabled: true,
      rsvpSlug: slug,
      rsvpCapacity: options.capacity ?? null,
      ...(options.cost ? { rsvpCostMode: "SPLIT" as const, rsvpCostCents: options.cost } : {}),
    },
    select: { id: true },
  });
  return { id: event.id, slug, organizationId };
}

function signUp(
  event: { id: string; organizationId: string },
  name: string,
  options: { via?: string } = {},
) {
  const email = `${name.split(" ")[0]!.toLowerCase()}-${randomBytes(3).toString("hex")}@x.test`;
  return withSystemOrgTx(event.organizationId, async ({ db }) => {
    const rules = await db.event.findFirstOrThrow({
      where: { id: event.id, organizationId: event.organizationId },
      select: RSVP_RULES_SELECT,
    });
    const outcome = await registerGuest(
      db,
      rules,
      { name, email, phone: "+16175550100" },
      { via: options.via },
    );
    if (outcome.kind !== "registered") throw new Error(`expected a sign-up, got ${outcome.kind}`);
    return { ...outcome, email };
  });
}

beforeAll(async () => {
  try {
    host = await makeUser("free-host");
    stranger = await makeUser("free-stranger");
    await ownerDb.organization.createMany({
      data: [
        {
          id: clubId,
          name: "Free Test Club",
          slug: `free-club-${tag}`,
          timezone: "America/New_York",
        },
        { id: otherClubId, name: "Other Club", slug: `free-other-${tag}`, timezone: "UTC" },
      ],
    });
    await ownerDb.membership.createMany({
      data: [
        { organizationId: clubId, userId: host.id, role: "ADMIN" },
        // In the other club the host is only a member: not a host there.
        { organizationId: otherClubId, userId: host.id, role: "MEMBER" },
      ],
    });
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  if (reachable) {
    const all = orgIds;
    await ownerDb.job.deleteMany({ where: { organizationId: { in: all } } });
    await ownerDb.attendance.deleteMany({ where: { organizationId: { in: all } } });
    await ownerDb.organization.deleteMany({ where: { id: { in: all } } });
    await ownerDb.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  }
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("the bring list", () => {
  it("gives the last slot to one guest when several grab it at once", async () => {
    if (!reachable) return;
    const event = await makeEvent(clubId);
    const guests = await Promise.all(["Bo One", "Cy Two", "Di Three"].map((n) => signUp(event, n)));
    const item = await withSystemOrgTx(clubId, async ({ db }) => {
      await saveRsvpItems(db, event, [{ label: "Speaker", slots: 1 }]);
      return db.rsvpItem.findFirstOrThrow({ where: { eventId: event.id } });
    });
    const outcomes = await Promise.all(
      guests.map((g) =>
        withSystemOrgTx(clubId, ({ db }) =>
          setItemClaim(db, event, g.registrationId, item.id, true),
        ),
      ),
    );
    expect(outcomes.filter((o) => o === "ok")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "full")).toHaveLength(2);
  });

  it("won't let a guest claim another event's line", async () => {
    if (!reachable) return;
    const a = await makeEvent(clubId);
    const b = await makeEvent(clubId);
    const guest = await signUp(a, "Ed Four");
    const itemB = await withSystemOrgTx(clubId, async ({ db }) => {
      await saveRsvpItems(db, b, [{ label: "Cups", slots: 5 }]);
      return db.rsvpItem.findFirstOrThrow({ where: { eventId: b.id } });
    });
    expect(
      await withSystemOrgTx(clubId, ({ db }) =>
        setItemClaim(db, a, guest.registrationId, itemB.id, true),
      ),
    ).toBe("gone");
    // The database refuses it too.
    await expect(
      ownerDb.rsvpItemClaim.create({
        data: { organizationId: clubId, itemId: itemB.id, registrationId: guest.registrationId },
      }),
    ).rejects.toThrow();
  });

  it("keeps lines on save, drops the ones left out with their claims", async () => {
    if (!reachable) return;
    const event = await makeEvent(clubId);
    const guest = await signUp(event, "Fi Five");
    await withSystemOrgTx(clubId, async ({ db }) => {
      await saveRsvpItems(db, event, [
        { label: "Chips", slots: 2 },
        { label: "Ice", slots: 1 },
      ]);
      const [chips, ice] = await db.rsvpItem.findMany({
        where: { eventId: event.id },
        orderBy: { position: "asc" },
      });
      await setItemClaim(db, event, guest.registrationId, ice!.id, true);
      await saveRsvpItems(db, event, [{ id: chips!.id, label: "Chips and dip", slots: 3 }]);
      const left = await db.rsvpItem.findMany({
        where: { eventId: event.id },
        select: { id: true, label: true, slots: true },
      });
      expect(left).toEqual([{ id: chips!.id, label: "Chips and dip", slots: 3 }]);
      expect(
        await db.rsvpItemClaim.count({ where: { registrationId: guest.registrationId } }),
      ).toBe(0);
    });
  });

  it("frees a guest's lines when they cancel, for someone else to take", async () => {
    if (!reachable) return;
    const event = await makeEvent(clubId);
    const [leaving, staying] = await Promise.all([
      signUp(event, "Gi Six"),
      signUp(event, "Ho Seven"),
    ]);
    const item = await withSystemOrgTx(clubId, async ({ db }) => {
      await saveRsvpItems(db, event, [{ label: "Napkins", slots: 1 }]);
      return db.rsvpItem.findFirstOrThrow({ where: { eventId: event.id } });
    });
    const claim = (registrationId: string) =>
      withSystemOrgTx(clubId, ({ db }) => setItemClaim(db, event, registrationId, item.id, true));
    expect(await claim(leaving!.registrationId)).toBe("ok");
    expect(await claim(staying!.registrationId)).toBe("full");

    await withSystemOrgTx(clubId, async ({ db }) =>
      setRegistrationStatus(
        db,
        await db.event.findFirstOrThrow({ where: { id: event.id }, select: RSVP_RULES_SELECT }),
        leaving!.registrationId,
        "CANCELLED",
      ),
    );
    expect(await ownerDb.rsvpItemClaim.count({ where: { itemId: item.id } })).toBe(0);
    expect(await claim(staying!.registrationId)).toBe("ok");
  });
});

describe("invite links", () => {
  it("credits whoever's link a guest came through, and the page names them", async () => {
    if (!reachable) return;
    const event = await makeEvent(clubId);
    const maya = await signUp(event, "Maya Patel");
    const mayaCode = (
      await ownerDb.eventRegistration.findUniqueOrThrow({
        where: { id: maya.registrationId },
        select: { inviteCode: true },
      })
    ).inviteCode;
    const leo = await signUp(event, "Leo Kim", { via: mayaCode });
    await signUp(event, "Noor Ali", { via: "zzzzzzzz" });
    const rows = await ownerDb.eventRegistration.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, invitedById: true },
    });
    expect(rows.map((r) => r.invitedById)).toEqual([null, maya.registrationId, null]);

    const target = { organizationId: clubId, eventId: event.id };
    const visitor = await loadRsvpPage(event.slug, target, null, { via: mayaCode });
    expect(visitor?.invitedBy).toBe("Maya Patel");
    const asMaya = await loadRsvpPage(event.slug, target, maya.registrationId, { via: mayaCode });
    expect(asMaya?.invitedBy).toBeNull();
    expect(asMaya?.viewer).toMatchObject({ invitedCount: 1 });
    expect(asMaya?.viewer?.inviteUrl).toContain(`?via=${mayaCode}`);
    expect(leo.status).toBe("GOING");
  });
});

describe("split the cost", () => {
  it("shares a total among everyone going, and records what guests say and hosts confirm", async () => {
    if (!reachable) return;
    const event = await makeEvent(clubId, { cost: 12000, capacity: 2 });
    const a = await signUp(event, "Al Pay");
    await signUp(event, "Bea Pay");
    const waiting = await signUp(event, "Cat Wait");
    expect(waiting.status).toBe("WAITLIST");

    const page = await loadRsvpPage(
      event.slug,
      { organizationId: clubId, eventId: event.id },
      a.registrationId,
    );
    expect(page?.cost).toMatchObject({ mode: "SPLIT", cents: 12000, share: 6000 });
    expect(page?.viewer?.owes).toBe(6000);

    await withSystemOrgTx(clubId, async ({ db }) => {
      expect(await claimPayment(db, event, a.registrationId, 6000)).toBe(true);
      // Only guests who are going pay.
      expect(await claimPayment(db, event, waiting.registrationId, 6000)).toBe(false);
      expect(await confirmPayment(db, event, waiting.registrationId, true, 6000)).toBe(true);
    });
    const after = await loadRsvpPage(
      event.slug,
      { organizationId: clubId, eventId: event.id },
      a.registrationId,
    );
    expect(after?.viewer?.paid).toEqual({ cents: 6000, confirmed: false });
  });
});

describe("tickets and check-in", () => {
  it("finds a ticket by its code on its own page only, and knows the hosts", async () => {
    if (!reachable) return;
    const event = await makeEvent(clubId);
    const guest = await signUp(event, "Gil Ticket");
    const { ticketCode } = await ownerDb.eventRegistration.findUniqueOrThrow({
      where: { id: guest.registrationId },
      select: { ticketCode: true },
    });
    expect(await loadTicket(event.slug, ticketCode)).toMatchObject({
      registrationId: guest.registrationId,
      name: "Gil Ticket",
      status: "GOING",
    });
    expect(await loadTicket("zzzzzzzz", ticketCode)).toBeNull();
    expect(await loadTicket(event.slug, "notacode")).toBeNull();
    expect(await isEventHost(host.id, clubId)).toBe(true);
    expect(await isEventHost(host.id, otherClubId)).toBe(false);
    expect(await isEventHost(stranger.id, clubId)).toBe(false);
  });

  it("in an organization, a check-in lands in its People and Attendance databases, and undoing it takes it out", async () => {
    if (!reachable) return;
    const event = await makeEvent(clubId);
    const guest = await signUp(event, "Hana Door");
    requireUserMock.mockResolvedValue(host);
    const result = await withOrgTx(clubId, ({ db }) =>
      setRegistrationCheckIn(db, {
        organizationId: clubId,
        eventId: event.id,
        registrationId: guest.registrationId,
        checkedIn: true,
        actorUserId: host.id,
        method: "QR",
      }),
    );
    expect(result).toMatchObject({ ok: true, name: "Hana Door", attendance: true });
    const reg = await ownerDb.eventRegistration.findUniqueOrThrow({
      where: { id: guest.registrationId },
      select: { checkedInAt: true, attendanceId: true },
    });
    expect(reg.checkedInAt).not.toBeNull();
    const attendance = await ownerDb.attendance.findUniqueOrThrow({
      where: { id: reg.attendanceId! },
      select: { eventId: true, method: true, contact: { select: { displayName: true } } },
    });
    expect(attendance).toEqual({
      eventId: event.id,
      method: "QR",
      contact: { displayName: "Hana Door" },
    });

    // A second scan says so and changes nothing.
    const again = await withOrgTx(clubId, ({ db }) =>
      setRegistrationCheckIn(db, {
        organizationId: clubId,
        eventId: event.id,
        registrationId: guest.registrationId,
        checkedIn: true,
        actorUserId: host.id,
        method: "QR",
      }),
    );
    expect(again).toMatchObject({ ok: true, already: true });

    await withOrgTx(clubId, ({ db }) =>
      setRegistrationCheckIn(db, {
        organizationId: clubId,
        eventId: event.id,
        registrationId: guest.registrationId,
        checkedIn: false,
        actorUserId: host.id,
        method: "MANUAL",
      }),
    );
    expect(await ownerDb.attendance.count({ where: { id: reg.attendanceId! } })).toBe(0);
  });
});
