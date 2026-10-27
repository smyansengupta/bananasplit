// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Public RSVP pages against the real roles, policies and app.rsvp_page on
 * the local database: spots and the waitlist (including a race for the last
 * spots), moving the waitlist up, what the public page reveals, who in the
 * suite can read sign-ups, reminders around a moved or started event, and
 * merging an event that has a page. A throwaway org is made as the table
 * owner and removed in afterAll. Skipped when the database is not reachable.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock, getSession: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgTx, withSystemOrgTx } from "@/server/db/context";
import { mergeEvents, updateEvent, type EventServiceContext } from "@/server/events/service";
import type { JobRun } from "@/server/jobs/types";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { rsvpEmailJob, rsvpFanoutJob } from "./jobs";
import { loadRsvpPage, rsvpPageTarget } from "./page";
import {
  registerGuest,
  RSVP_RULES_SELECT,
  scheduleEventReminders,
  setRegistrationStatus,
} from "./service";

const tag = randomBytes(4).toString("hex");
const orgId = `c_rsvptest_${tag}`;
const slugChars = "abcdefghjkmnpqrstuvwxyz23456789";
const randomSlug = () =>
  Array.from(randomBytes(8), (b) => slugChars[b % slugChars.length]).join("");

let admin: { id: string; email: string; name: string };
let member: { id: string; email: string; name: string };
let reachable = true;

async function makeUser(local: string) {
  const email = `${local}-${tag}@example.edu`;
  const row = await authDb.user.create({
    data: { email, name: local, emailVerified: new Date(), onboardedAt: new Date() },
    select: { id: true, email: true, name: true },
  });
  return { id: row.id, email: row.email, name: row.name ?? local };
}

const DAY = 24 * 60 * 60 * 1000;

async function makeEvent(rules: {
  capacity: number | null;
  waitlist: boolean;
  hideLocation?: boolean;
  startsAt?: Date;
  allDay?: boolean;
}) {
  const slug = randomSlug();
  const start = rules.startsAt ?? new Date(Date.now() + 3 * DAY);
  const event = await ownerDb.event.create({
    data: {
      organizationId: orgId,
      title: "Robot demo night",
      startsAt: start,
      endsAt: new Date(start.getTime() + 2 * 60 * 60 * 1000),
      location: "Engineering Hall 112, 1 Main St",
      locationDetails: "Second floor, east wing.",
      createdById: admin.id,
      rsvpEnabled: true,
      rsvpSlug: slug,
      rsvpCapacity: rules.capacity,
      rsvpWaitlist: rules.waitlist,
      rsvpHideLocation: rules.hideLocation ?? false,
      allDay: rules.allDay ?? false,
    },
    select: { id: true },
  });
  return { id: event.id, slug };
}

/** What scheduleEventReminders needs from the event. */
function scheduleOf(eventId: string) {
  return withSystemOrgTx(orgId, ({ db }) =>
    db.event.findFirstOrThrow({
      where: { id: eventId, organizationId: orgId },
      select: {
        id: true,
        organizationId: true,
        startsAt: true,
        allDay: true,
        reminderMinutes: true,
      },
    }),
  );
}

function rulesOf(eventId: string) {
  return withSystemOrgTx(orgId, ({ db }) =>
    db.event.findFirstOrThrow({
      where: { id: eventId, organizationId: orgId },
      select: RSVP_RULES_SELECT,
    }),
  );
}

function signUp(eventId: string, name: string, email: string) {
  return withSystemOrgTx(orgId, async ({ db }) => {
    const event = await db.event.findFirstOrThrow({
      where: { id: eventId, organizationId: orgId },
      select: RSVP_RULES_SELECT,
    });
    return registerGuest(db, event, { name, email, phone: "+16175550100" });
  });
}

function setStatus(
  eventId: string,
  registrationId: string,
  status: "GOING" | "WAITLIST" | "CANCELLED",
) {
  return withSystemOrgTx(orgId, async ({ db }) =>
    setRegistrationStatus(
      db,
      await db.event.findFirstOrThrow({ where: { id: eventId }, select: RSVP_RULES_SELECT }),
      registrationId,
      status,
    ),
  );
}

/** The events service as the owner, on the service path (as the Sessions database runs it). */
function asOwner<T>(fn: (ctx: EventServiceContext) => Promise<T>): Promise<T> {
  return withSystemOrgTx(orgId, { userId: admin.id }, (ctx) =>
    fn({ ...ctx, organizationId: orgId, userId: admin.id, role: "OWNER", kind: "system" }),
  );
}

function run<P>(kind: string, payload: P): JobRun<P> {
  return {
    id: "job_test",
    kind,
    organizationId: orgId,
    payload,
    dedupeKey: kind,
    attempt: 1,
    maxAttempts: 8,
    signal: new AbortController().signal,
    deadline: Date.now() + 20_000,
  };
}

function registered(outcome: Awaited<ReturnType<typeof signUp>>) {
  if (outcome.kind !== "registered") throw new Error(`expected a sign-up, got ${outcome.kind}`);
  return outcome;
}

function statuses(eventId: string) {
  return ownerDb.eventRegistration.findMany({
    where: { eventId },
    orderBy: { createdAt: "asc" },
    select: { email: true, status: true },
  });
}

beforeAll(async () => {
  try {
    admin = await makeUser("rsvp-admin");
    member = await makeUser("rsvp-member");
    await ownerDb.organization.create({
      data: {
        id: orgId,
        name: "RSVP Test",
        slug: `rsvp-test-${tag}`,
        timezone: "America/New_York",
      },
    });
    await ownerDb.membership.createMany({
      data: [
        { organizationId: orgId, userId: admin.id, role: "OWNER" },
        { organizationId: orgId, userId: member.id, role: "MEMBER" },
      ],
    });
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  if (reachable) {
    await ownerDb.job.deleteMany({ where: { organizationId: orgId } });
    await ownerDb.organization.deleteMany({ where: { id: orgId } });
    await ownerDb.user.deleteMany({
      where: { id: { in: [admin, member].filter(Boolean).map((u) => u.id) } },
    });
  }
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("RSVP pages against the local database", () => {
  it("finds a live page by its code, and nothing for an unknown or switched-off one", async () => {
    if (!reachable) return;
    const event = await makeEvent({ capacity: null, waitlist: true });
    expect(await rsvpPageTarget(event.slug)).toEqual({ organizationId: orgId, eventId: event.id });
    expect(await rsvpPageTarget("zzzzzzzz")).toBeNull();
    expect(await rsvpPageTarget("NOT-A-CODE")).toBeNull();
    await ownerDb.event.update({ where: { id: event.id }, data: { rsvpEnabled: false } });
    expect(await rsvpPageTarget(event.slug)).toBeNull();
  });

  it("fills the spots, then the waitlist; the same email twice is one sign-up", async () => {
    if (!reachable) return;
    const event = await makeEvent({ capacity: 2, waitlist: true });
    expect(await signUp(event.id, "Ava One", `ava-${tag}@x.test`)).toMatchObject({
      status: "GOING",
    });
    expect(await signUp(event.id, "Ben Two", `ben-${tag}@x.test`)).toMatchObject({
      status: "GOING",
    });
    expect(await signUp(event.id, "Cam Three", `cam-${tag}@x.test`)).toMatchObject({
      status: "WAITLIST",
    });
    expect(await signUp(event.id, "Ava Again", `ava-${tag}@x.test`)).toEqual({ kind: "exists" });
    expect((await statuses(event.id)).map((r) => r.status)).toEqual(["GOING", "GOING", "WAITLIST"]);
    // A confirmation was queued for each new sign-up.
    const jobs = await ownerDb.job.count({ where: { organizationId: orgId, kind: "rsvp-email" } });
    expect(jobs).toBeGreaterThanOrEqual(3);
  });

  it("is full without a waitlist", async () => {
    if (!reachable) return;
    const event = await makeEvent({ capacity: 1, waitlist: false });
    await signUp(event.id, "Dee Four", `dee-${tag}@x.test`);
    expect(await signUp(event.id, "Eli Five", `eli-${tag}@x.test`)).toEqual({
      kind: "closed",
      reason: "full",
    });
  });

  it("moves the first person on the waitlist up when someone going cancels", async () => {
    if (!reachable) return;
    const event = await makeEvent({ capacity: 1, waitlist: true });
    const first = await signUp(event.id, "Fay Six", `fay-${tag}@x.test`);
    await signUp(event.id, "Gus Seven", `gus-${tag}@x.test`);
    await signUp(event.id, "Hal Eight", `hal-${tag}@x.test`);
    if (first.kind !== "registered") throw new Error("expected a sign-up");
    await withSystemOrgTx(orgId, async ({ db }) =>
      setRegistrationStatus(
        db,
        await db.event.findFirstOrThrow({ where: { id: event.id }, select: RSVP_RULES_SELECT }),
        first.registrationId,
        "CANCELLED",
      ),
    );
    expect(await statuses(event.id)).toEqual([
      { email: `fay-${tag}@x.test`, status: "CANCELLED" },
      { email: `gus-${tag}@x.test`, status: "GOING" },
      { email: `hal-${tag}@x.test`, status: "WAITLIST" },
    ]);
    expect(
      await ownerDb.job.count({
        where: { organizationId: orgId, dedupeKey: { contains: ":promoted" } },
      }),
    ).toBeGreaterThanOrEqual(1);
  });

  it("never gives out more spots than there are, however many sign up at once", async () => {
    if (!reachable) return;
    const event = await makeEvent({ capacity: 2, waitlist: true });
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        signUp(event.id, `Racer ${i}`, `racer${i}-${tag}@x.test`),
      ),
    );
    const going = results.filter((r) => r.kind === "registered" && r.status === "GOING").length;
    expect(going).toBe(2);
    expect((await statuses(event.id)).filter((r) => r.status === "WAITLIST")).toHaveLength(4);
  });

  it("shows the public short names and counts, never emails or phones, and the address only to guests when hidden", async () => {
    if (!reachable) return;
    const event = await makeEvent({ capacity: 10, waitlist: true, hideLocation: true });
    const mine = await signUp(event.id, "Ivy Nine Stone", `ivy-${tag}@x.test`);
    if (mine.kind !== "registered") throw new Error("expected a sign-up");
    const target = { organizationId: orgId, eventId: event.id };

    const stranger = await loadRsvpPage(event.slug, target, null);
    expect(stranger).toMatchObject({
      going: 1,
      spotsLeft: 9,
      location: null,
      locationHidden: true,
      viewer: null,
    });
    expect(stranger?.guests).toEqual([expect.objectContaining({ name: "Ivy Nine Stone" })]);
    expect(JSON.stringify(stranger)).not.toContain("@x.test");
    expect(JSON.stringify(stranger)).not.toContain("6175550100");

    const guest = await loadRsvpPage(event.slug, target, mine.registrationId);
    expect(guest).toMatchObject({
      location: "Engineering Hall 112, 1 Main St",
      locationDetails: "Second floor, east wing.",
      viewer: { status: "GOING", firstName: "Ivy" },
    });
    // Another event's sign-up is no key to this one.
    const other = await makeEvent({ capacity: null, waitlist: true });
    expect(
      (
        await loadRsvpPage(
          other.slug,
          { organizationId: orgId, eventId: other.id },
          mine.registrationId,
        )
      )?.viewer,
    ).toBeNull();
  });

  it("in the suite, only owners and admins read sign-ups", async () => {
    if (!reachable) return;
    const event = await makeEvent({ capacity: null, waitlist: true });
    await signUp(event.id, "Jo Ten", `jo-${tag}@x.test`);
    requireUserMock.mockResolvedValue(admin);
    const asAdmin = await withOrgTx(orgId, ({ db }) =>
      db.eventRegistration.findMany({ where: { eventId: event.id }, select: { email: true } }),
    );
    expect(asAdmin).toEqual([{ email: `jo-${tag}@x.test` }]);
    requireUserMock.mockResolvedValue(member);
    const asMember = await withOrgTx(orgId, ({ db }) =>
      db.eventRegistration.findMany({ where: { eventId: event.id }, select: { email: true } }),
    );
    expect(asMember).toEqual([]);
  });

  it("queues the day-before and hour-before reminders for the event's start", async () => {
    if (!reachable) return;
    const event = await makeEvent({ capacity: null, waitlist: true });
    const schedule = await scheduleOf(event.id);
    // A new event's offsets default to a day's notice and an hour's.
    expect(schedule.reminderMinutes).toEqual([1440, 60]);
    await withSystemOrgTx(orgId, ({ db }) => scheduleEventReminders(db, schedule));
    const jobs = await ownerDb.job.findMany({
      where: { organizationId: orgId, kind: "rsvp-fanout", dedupeKey: { contains: event.id } },
      select: { dedupeKey: true, runAt: true },
    });
    expect(jobs.map((j) => j.dedupeKey.split(":")[2]).sort()).toEqual(["r1440", "r60"]);
  });

  it("queues only the day-before reminder for an all-day event", async () => {
    if (!reachable) return;
    const event = await makeEvent({ capacity: null, waitlist: true, allDay: true });
    const schedule = await scheduleOf(event.id);
    await withSystemOrgTx(orgId, ({ db }) => scheduleEventReminders(db, schedule));
    const jobs = await ownerDb.job.findMany({
      where: { organizationId: orgId, kind: "rsvp-fanout", dedupeKey: { contains: event.id } },
      select: { dedupeKey: true },
    });
    expect(jobs.map((j) => j.dedupeKey.split(":")[2])).toEqual(["r1440"]);
  });

  it("gives the spot a host frees by moving a guest to the waitlist to the next in line", async () => {
    if (!reachable) return;
    const event = await makeEvent({ capacity: 1, waitlist: true });
    const ann = registered(await signUp(event.id, "Ann Moved", `ann-freed-${tag}@x.test`));
    const bo = registered(await signUp(event.id, "Bo Next", `bo-freed-${tag}@x.test`));
    expect(bo.status).toBe("WAITLIST");
    await setStatus(event.id, ann.registrationId, "WAITLIST");
    const rows = await ownerDb.eventRegistration.findMany({
      where: { eventId: event.id },
      select: { id: true, status: true },
    });
    expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({
      [ann.registrationId]: "WAITLIST",
      [bo.registrationId]: "GOING",
    });
    const promoted = await ownerDb.job.findMany({
      where: { organizationId: orgId, dedupeKey: { endsWith: ":promoted" } },
      select: { dedupeKey: true },
    });
    const keys = promoted.map((j) => j.dedupeKey);
    expect(keys).toContain(`rsvp-email:${bo.registrationId}:promoted`);
    expect(keys).not.toContain(`rsvp-email:${ann.registrationId}:promoted`);
  });

  it("keeps a guest a host moves to the waitlist there, without a 'spot opened' email", async () => {
    if (!reachable) return;
    const event = await makeEvent({ capacity: 1, waitlist: true });
    const ava = registered(await signUp(event.id, "Ava Moved", `ava-moved-${tag}@x.test`));
    await setStatus(event.id, ava.registrationId, "WAITLIST");
    expect(await statuses(event.id)).toEqual([
      { email: `ava-moved-${tag}@x.test`, status: "WAITLIST" },
    ]);
    expect(
      await ownerDb.job.count({
        where: { organizationId: orgId, dedupeKey: `rsvp-email:${ava.registrationId}:promoted` },
      }),
    ).toBe(0);
  });

  it("puts someone who cancels and signs up again at the back of the line", async () => {
    if (!reachable) return;
    const event = await makeEvent({ capacity: 1, waitlist: true });
    const target = { organizationId: orgId, eventId: event.id };
    const ann = registered(await signUp(event.id, "Ann Going", `ann-line-${tag}@x.test`));
    const bo = registered(await signUp(event.id, "Bo First", `bo-line-${tag}@x.test`));
    const cy = registered(await signUp(event.id, "Cy Second", `cy-line-${tag}@x.test`));
    expect(bo.status).toBe("WAITLIST");

    await setStatus(event.id, bo.registrationId, "CANCELLED");
    const again = registered(await signUp(event.id, "Bo First", `bo-line-${tag}@x.test`));
    expect(again).toMatchObject({ registrationId: bo.registrationId, status: "WAITLIST" });
    const place = async (id: string) =>
      (await loadRsvpPage(event.slug, target, id))?.viewer?.waitlistPosition;
    expect(await place(cy.registrationId)).toBe(1);
    expect(await place(bo.registrationId)).toBe(2);

    // Ann's spot goes to Cy, who waited longer.
    await setStatus(event.id, ann.registrationId, "CANCELLED");
    const after = await ownerDb.eventRegistration.findMany({
      where: { eventId: event.id, status: { not: "CANCELLED" } },
      select: { id: true, status: true },
    });
    expect(after).toEqual(
      expect.arrayContaining([
        { id: cy.registrationId, status: "GOING" },
        { id: bo.registrationId, status: "WAITLIST" },
      ]),
    );
  });

  it("reminds everyone again after the event moves, and drops reminders once it has started", async () => {
    if (!reachable) return;
    const event = await makeEvent({ capacity: null, waitlist: true });
    const guest = registered(await signUp(event.id, "Kit Moved", `kit-moved-${tag}@x.test`));
    // Kit was reminded a day before the old time.
    await ownerDb.eventReminderSend.create({
      data: {
        organizationId: orgId,
        eventId: event.id,
        offsetMinutes: 1440,
        registrationId: guest.registrationId,
        recipientKey: `g:${guest.registrationId}`,
        channel: "email",
        sentAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });
    const before = await rulesOf(event.id);
    const startsAt = new Date(before.startsAt.getTime() + 2 * DAY);
    await asOwner((ctx) =>
      updateEvent(ctx, event.id, {
        startsAt,
        endsAt: new Date(startsAt.getTime() + 2 * 60 * 60 * 1000),
      }),
    );

    // The new start's day-before fan-out forgets the old time's send and
    // queues the guest's reminder again.
    await rsvpFanoutJob(
      run("rsvp-fanout", {
        eventId: event.id,
        stage: "reminder" as const,
        offsetMinutes: 1440,
        startsAt: startsAt.toISOString(),
      }),
    );
    expect(await ownerDb.eventReminderSend.count({ where: { eventId: event.id } })).toBe(0);
    const minute = Math.floor(startsAt.getTime() / 60_000);
    expect(
      await ownerDb.job.findFirst({
        where: {
          organizationId: orgId,
          dedupeKey: `rsvp-email:${guest.registrationId}:reminder:r1440:${minute}`,
        },
        select: { payload: true },
      }),
    ).toEqual({
      payload: {
        registrationId: guest.registrationId,
        template: "reminder",
        offsetMinutes: 1440,
        startsAt: startsAt.toISOString(),
      },
    });

    // Started ten minutes ago: a late reminder is dropped, not claimed or sent.
    const started = await makeEvent({
      capacity: null,
      waitlist: true,
      startsAt: new Date(Date.now() - 10 * 60 * 1000),
    });
    const late = registered(await signUp(started.id, "Lou Late", `lou-late-${tag}@x.test`));
    const { startsAt: lateStart } = await rulesOf(started.id);
    expect(
      await rsvpEmailJob(
        run("rsvp-email", {
          registrationId: late.registrationId,
          template: "reminder" as const,
          offsetMinutes: 60,
          startsAt: lateStart.toISOString(),
        }),
      ),
    ).toEqual({ status: "DONE" });
    expect(await ownerDb.eventReminderSend.count({ where: { eventId: started.id } })).toBe(0);
    expect(
      await rsvpFanoutJob(
        run("rsvp-fanout", {
          eventId: started.id,
          stage: "reminder" as const,
          offsetMinutes: 60,
          startsAt: lateStart.toISOString(),
        }),
      ),
    ).toEqual({ status: "DONE" });
    expect(
      await ownerDb.job.count({
        where: {
          organizationId: orgId,
          dedupeKey: { startsWith: `rsvp-email:${late.registrationId}:reminder` },
        },
      }),
    ).toBe(0);
  });

  it("fans reminders out to everyone going in one go, with the usual keys", async () => {
    if (!reachable) return;
    const event = await makeEvent({ capacity: 3, waitlist: true });
    const guests = [];
    for (const n of ["Mo", "Ned", "Oli", "Pam"]) {
      guests.push(
        registered(await signUp(event.id, `${n} Fan`, `${n.toLowerCase()}-fan-${tag}@x.test`)),
      );
    }
    const { startsAt } = await rulesOf(event.id);
    await rsvpFanoutJob(
      run("rsvp-fanout", {
        eventId: event.id,
        stage: "reminder" as const,
        offsetMinutes: 60,
        startsAt: startsAt.toISOString(),
      }),
    );
    const minute = Math.floor(startsAt.getTime() / 60_000);
    const keys = (
      await ownerDb.job.findMany({
        where: {
          organizationId: orgId,
          kind: "rsvp-email",
          dedupeKey: { endsWith: `:reminder:r60:${minute}` },
        },
        select: { dedupeKey: true },
      })
    ).map((j) => j.dedupeKey);
    // The three going, not Pam on the waitlist.
    expect(keys.sort()).toEqual(
      guests
        .filter((g) => g.status === "GOING")
        .map((g) => `rsvp-email:${g.registrationId}:reminder:r60:${minute}`)
        .sort(),
    );
    expect(guests.filter((g) => g.status === "GOING")).toHaveLength(3);
  });

  it("won't merge away a live page people signed up on, but will once it's off", async () => {
    if (!reachable) return;
    const keep = await makeEvent({ capacity: null, waitlist: true });
    const drop = await makeEvent({ capacity: null, waitlist: true });
    await signUp(drop.id, "Quin Merged", `quin-merge-${tag}@x.test`);
    const merge = () => asOwner((ctx) => mergeEvents(ctx, keep.id, drop.id));

    await expect(merge()).rejects.toThrow(/Merge the other way round/);
    expect(await rsvpPageTarget(drop.slug)).toEqual({ organizationId: orgId, eventId: drop.id });

    await ownerDb.event.update({ where: { id: drop.id }, data: { rsvpEnabled: false } });
    expect((await merge()).survivor.id).toBe(keep.id);
  });
});
