// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * One reminder fanout for members and public guests, against the real
 * roles, policies and CHECK constraints of the local database
 * (docs/features/meetings.md): which fanouts a meeting queues, who each one
 * reminds, what a member's reminder says (the join link, never the host
 * link), and the once-only guard (EventReminderSend) around a move, a
 * retried job and a failed send. The mailer is a mock; everything else is
 * real. A throwaway org is made as the table owner and removed in afterAll.
 * Skipped when the database is not reachable.
 */

const { mailerSend } = vi.hoisted(() => ({ mailerSend: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn(), getSession: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));
vi.mock("@/server/email/mailer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/email/mailer")>()),
  getOrgMailer: vi.fn(async () => null),
  platformFallbackMailer: () => ({ kind: "platform-fallback", send: mailerSend }),
}));
vi.mock("@/server/sms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/sms")>()),
  smsDelivery: () => "off",
}));

import type { MeetingFormat, RSVPStatus } from "@/generated/prisma/client";
import { whenLine } from "@/lib/rsvp/when";
import { authDb, disconnectAll } from "@/server/db/clients";
import { withSystemOrgTx } from "@/server/db/context";
import {
  createEvent,
  updateEvent,
  type EventInput,
  type EventServiceContext,
} from "@/server/events/service";
import type { JobRun } from "@/server/jobs/types";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { rsvpEmailJob, rsvpFanoutJob } from "./jobs";
import {
  enqueueRsvpEmails,
  registerGuest,
  RSVP_RULES_SELECT,
  scheduleEventReminders,
} from "./service";

const tag = randomBytes(4).toString("hex");
const orgId = `c_remfan_${tag}`;
const orgSlug = `remfan-${tag}`;
const TZ = "America/New_York";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const slugChars = "abcdefghjkmnpqrstuvwxyz23456789";
const randomSlug = () =>
  Array.from(randomBytes(8), (b) => slugChars[b % slugChars.length]).join("");

interface Person {
  id: string;
  email: string;
}

let reachable = true;
let owner: Person;
let yes: Person;
let maybe: Person;
let pending: Person;
let declined: Person;
/** Was invited, then left the organization: the attendee row outlived the membership. */
let former: Person;

async function makeUser(local: string): Promise<Person> {
  return authDb.user.create({
    data: {
      email: `${local}-${tag}@example.edu`,
      name: local,
      emailVerified: new Date(),
      onboardedAt: new Date(),
    },
    select: { id: true, email: true },
  });
}

interface EventSpec {
  title?: string;
  startsAt?: Date;
  allDay?: boolean;
  rsvp?: boolean;
  format?: MeetingFormat;
  location?: string | null;
  conferenceUrl?: string | null;
  conferenceHostUrl?: string | null;
  reminderMinutes?: number[];
  attendees?: [string, RSVPStatus][];
}

/** A meeting written as the table owner, so nothing is queued until a test asks. */
async function makeEvent(spec: EventSpec = {}) {
  const startsAt = spec.startsAt ?? new Date(Date.now() + 3 * DAY);
  const online = spec.format === "ONLINE" || spec.format === "HYBRID";
  const event = await ownerDb.event.create({
    data: {
      organizationId: orgId,
      title: spec.title ?? "General meeting",
      startsAt,
      endsAt: new Date(startsAt.getTime() + HOUR),
      allDay: spec.allDay ?? false,
      location: spec.location === undefined ? "Curry 344" : spec.location,
      format: spec.format ?? "IN_PERSON",
      conferenceProvider: online ? "ZOOM" : "NONE",
      conferenceUrl: online ? (spec.conferenceUrl ?? null) : null,
      conferenceHostUrl: online ? (spec.conferenceHostUrl ?? null) : null,
      createdById: owner.id,
      ...(spec.reminderMinutes ? { reminderMinutes: spec.reminderMinutes } : {}),
      ...(spec.rsvp ? { rsvpEnabled: true, rsvpSlug: randomSlug() } : {}),
    },
    select: { id: true, startsAt: true },
  });
  if (spec.attendees?.length) {
    await ownerDb.eventAttendee.createMany({
      data: spec.attendees.map(([userId, rsvp]) => ({
        organizationId: orgId,
        eventId: event.id,
        userId,
        rsvp,
      })),
    });
  }
  return event;
}

/** The events service as the owner, on the service path (as the Sessions database runs it). */
function asOwner<T>(fn: (ctx: EventServiceContext) => Promise<T>): Promise<T> {
  return withSystemOrgTx(orgId, { userId: owner.id }, (ctx) =>
    fn({ ...ctx, organizationId: orgId, userId: owner.id, role: "OWNER", kind: "system" }),
  );
}

function input(startsAt: Date, extra: Partial<EventInput> = {}): EventInput {
  return {
    title: "General meeting",
    startsAt,
    endsAt: new Date(startsAt.getTime() + HOUR),
    ...extra,
  };
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

/**
 * Runs `fn` with the clock at `when`. A fanout runs at its runAt, never
 * before, so the tests that run one twice run it then: a send made for
 * this time is then never mistaken for one made for an earlier time.
 */
async function at<T>(when: Date, fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ["Date"], now: when, shouldAdvanceTime: true });
  try {
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}

const minuteOf = (d: Date) => Math.floor(d.getTime() / MINUTE);

function fanout(eventId: string, startsAt: Date, offsetMinutes: number) {
  return rsvpFanoutJob(
    run("rsvp-fanout", {
      eventId,
      stage: "reminder" as const,
      offsetMinutes,
      startsAt: startsAt.toISOString(),
    }),
  );
}

function fanoutJobs(eventId: string) {
  return ownerDb.job.findMany({
    where: { organizationId: orgId, kind: "rsvp-fanout", dedupeKey: { contains: `:${eventId}:r` } },
    orderBy: { runAt: "asc" },
    select: { dedupeKey: true, runAt: true, payload: true, status: true },
  });
}

function signUp(eventId: string, name: string, email: string, userId?: string) {
  return withSystemOrgTx(orgId, async ({ db }) => {
    const event = await db.event.findFirstOrThrow({
      where: { id: eventId, organizationId: orgId },
      select: RSVP_RULES_SELECT,
    });
    const outcome = await registerGuest(db, event, {
      name,
      email,
      phone: "+16175550100",
      userId: userId ?? null,
    });
    if (outcome.kind !== "registered") throw new Error(`expected a sign-up, got ${outcome.kind}`);
    return outcome;
  });
}

/** The reminder emails the fanout queued for one guest (the job rows). */
function reminderEmailJobs(registrationId: string) {
  return ownerDb.job.findMany({
    where: {
      organizationId: orgId,
      kind: "rsvp-email",
      dedupeKey: { startsWith: `rsvp-email:${registrationId}:reminder` },
    },
    select: { dedupeKey: true, payload: true, status: true },
  });
}

/** Runs every queued reminder email for these guests, as the drain would. */
async function runReminderEmails(registrationIds: string[]) {
  for (const id of registrationIds) {
    for (const job of await reminderEmailJobs(id)) {
      if (job.status !== "PENDING") continue;
      await rsvpEmailJob(run("rsvp-email", job.payload as never));
    }
  }
}

function reminders(eventId: string) {
  return ownerDb.notification.findMany({
    where: {
      organizationId: orgId,
      type: "EVENT_REMINDER",
      dedupeKey: { startsWith: `event-reminder:${eventId}:` },
    },
    orderBy: { createdAt: "asc" },
    select: { userId: true, title: true, body: true, linkUrl: true, dedupeKey: true },
  });
}

function sends(eventId: string) {
  return ownerDb.eventReminderSend.findMany({
    where: { eventId },
    orderBy: { sentAt: "asc" },
    select: { offsetMinutes: true, channel: true, recipientKey: true, sentAt: true },
  });
}

/** Mail the mock mailer was asked to send to `to`. */
const mailTo = (to: string) =>
  mailerSend.mock.calls
    .map((c) => c[0] as { to: string; subject: string; text: string; html: string })
    .filter((m) => m.to === to);

beforeAll(async () => {
  try {
    owner = await makeUser("remfan-owner");
    yes = await makeUser("remfan-yes");
    maybe = await makeUser("remfan-maybe");
    pending = await makeUser("remfan-pending");
    declined = await makeUser("remfan-no");
    former = await makeUser("remfan-former");
    await ownerDb.organization.create({
      data: { id: orgId, name: "Reminder Fanout Test", slug: orgSlug, timezone: TZ },
    });
    await ownerDb.membership.createMany({
      data: [
        { organizationId: orgId, userId: owner.id, role: "OWNER" },
        ...[yes, maybe, pending, declined, former].map((u) => ({
          organizationId: orgId,
          userId: u.id,
          role: "MEMBER" as const,
        })),
      ],
    });
  } catch {
    reachable = false;
  }
});

beforeEach(() => {
  mailerSend.mockReset();
  mailerSend.mockResolvedValue(undefined);
});

afterAll(async () => {
  if (reachable) {
    await ownerDb.job.deleteMany({ where: { organizationId: orgId } });
    await ownerDb.organization.deleteMany({ where: { id: orgId } });
    await ownerDb.user.deleteMany({
      where: {
        id: {
          in: [owner, yes, maybe, pending, declined, former].filter(Boolean).map((u) => u.id),
        },
      },
    });
  }
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("scheduling a meeting's reminders", () => {
  it("schedules one fanout per offset at start minus offset", async () => {
    if (!reachable) return;
    const startsAt = new Date(Date.now() + 3 * DAY);
    const { event } = await asOwner((ctx) =>
      createEvent(ctx, input(startsAt, { reminderMinutes: [1440, 60, 10] })),
    );
    const minute = minuteOf(event.startsAt);
    const jobs = await fanoutJobs(event.id);
    expect(jobs).toEqual(
      [1440, 60, 10].map((offset) => ({
        dedupeKey: `rsvp-fanout:${event.id}:r${offset}:${minute}`,
        runAt: new Date(event.startsAt.getTime() - offset * MINUTE),
        payload: {
          eventId: event.id,
          stage: "reminder",
          offsetMinutes: offset,
          startsAt: event.startsAt.toISOString(),
        },
        status: "PENDING",
      })),
    );
  });

  it("skips offsets already past", async () => {
    if (!reachable) return;
    const event = await makeEvent({ startsAt: new Date(Date.now() + 2 * HOUR) });
    const queued = await withSystemOrgTx(orgId, ({ db }) =>
      scheduleEventReminders(db, {
        id: event.id,
        organizationId: orgId,
        startsAt: event.startsAt,
        allDay: false,
        reminderMinutes: [1440, 60, 10],
      }),
    );
    expect(queued).toBe(2);
    expect((await fanoutJobs(event.id)).map((j) => j.dedupeKey.split(":")[2])).toEqual([
      "r60",
      "r10",
    ]);
  });

  it("an all-day event keeps only offsets of a day or more", async () => {
    if (!reachable) return;
    const event = await makeEvent({ startsAt: new Date(Date.now() + 5 * DAY), allDay: true });
    const queued = await withSystemOrgTx(orgId, ({ db }) =>
      scheduleEventReminders(db, {
        id: event.id,
        organizationId: orgId,
        startsAt: event.startsAt,
        allDay: true,
        reminderMinutes: [2880, 1440, 60, 10],
      }),
    );
    expect(queued).toBe(2);
    expect((await fanoutJobs(event.id)).map((j) => j.dedupeKey.split(":")[2])).toEqual([
      "r2880",
      "r1440",
    ]);
  });

  it("an imported event schedules nothing", async () => {
    if (!reachable) return;
    const startsAt = new Date(Date.now() + 3 * DAY);
    const imported = await asOwner((ctx) =>
      createEvent(ctx, input(startsAt), { origin: "import" }),
    );
    const synced = await asOwner((ctx) => createEvent(ctx, input(startsAt), { origin: "sync" }));
    expect(await fanoutJobs(imported.event.id)).toEqual([]);
    expect(await fanoutJobs(synced.event.id)).toEqual([]);
  });

  it("moving the start schedules the new time's fanouts", async () => {
    if (!reachable) return;
    const startsAt = new Date(Date.now() + 3 * DAY);
    const { event } = await asOwner((ctx) =>
      createEvent(ctx, input(startsAt, { reminderMinutes: [1440, 60] })),
    );
    const moved = new Date(event.startsAt.getTime() + DAY);
    await asOwner((ctx) =>
      updateEvent(ctx, event.id, { startsAt: moved, endsAt: new Date(moved.getTime() + HOUR) }),
    );
    const keys = (await fanoutJobs(event.id)).map((j) => j.dedupeKey);
    for (const offset of [1440, 60]) {
      expect(keys).toContain(`rsvp-fanout:${event.id}:r${offset}:${minuteOf(moved)}`);
    }
    // An edit that moves nothing and keeps the offsets queues nothing new.
    await asOwner((ctx) => updateEvent(ctx, event.id, { title: "General meeting (room 2)" }));
    expect(await fanoutJobs(event.id)).toHaveLength(4);
  });

  it("changing the reminder times schedules the new ones", async () => {
    if (!reachable) return;
    const startsAt = new Date(Date.now() + 3 * DAY);
    const { event } = await asOwner((ctx) =>
      createEvent(ctx, input(startsAt, { reminderMinutes: [1440] })),
    );
    await asOwner((ctx) => updateEvent(ctx, event.id, { reminderMinutes: [1440, 30] }));
    expect((await fanoutJobs(event.id)).map((j) => j.dedupeKey).sort()).toEqual(
      [
        `rsvp-fanout:${event.id}:r1440:${minuteOf(event.startsAt)}`,
        `rsvp-fanout:${event.id}:r30:${minuteOf(event.startsAt)}`,
      ].sort(),
    );
  });
});

describe("who a reminder reaches", () => {
  it("reminds GOING guests once", async () => {
    if (!reachable) return;
    const event = await makeEvent({ rsvp: true });
    await ownerDb.event.update({
      where: { id: event.id },
      data: { rsvpCapacity: 2, rsvpWaitlist: true },
    });
    const ava = await signUp(event.id, "Ava Going", `ava-once-${tag}@x.test`);
    const ben = await signUp(event.id, "Ben Going", `ben-once-${tag}@x.test`);
    const cal = await signUp(event.id, "Cal Waiting", `cal-once-${tag}@x.test`);
    expect([ava.status, ben.status, cal.status]).toEqual(["GOING", "GOING", "WAITLIST"]);
    const runAt = new Date(event.startsAt.getTime() - HOUR);
    const minute = minuteOf(event.startsAt);

    await at(runAt, () => fanout(event.id, event.startsAt, 60));
    await at(runAt, () => fanout(event.id, event.startsAt, 60));
    for (const guest of [ava, ben]) {
      expect(await reminderEmailJobs(guest.registrationId)).toEqual([
        {
          dedupeKey: `rsvp-email:${guest.registrationId}:reminder:r60:${minute}`,
          payload: {
            registrationId: guest.registrationId,
            template: "reminder",
            offsetMinutes: 60,
            startsAt: event.startsAt.toISOString(),
          },
          status: "PENDING",
        },
      ]);
    }
    expect(await reminderEmailJobs(cal.registrationId)).toEqual([]);

    // The drain runs each email twice (a lost lease): one send each.
    await at(runAt, () => runReminderEmails([ava.registrationId, ben.registrationId]));
    await at(runAt, () => runReminderEmails([ava.registrationId, ben.registrationId]));
    expect(mailTo(`ava-once-${tag}@x.test`)).toHaveLength(1);
    expect(mailTo(`ben-once-${tag}@x.test`)).toHaveLength(1);
    expect(mailTo(`ava-once-${tag}@x.test`)[0]?.subject).toBe(
      "Starting in an hour: General meeting",
    );

    // A fanout run again once those went out queues nothing more.
    await ownerDb.job.updateMany({
      where: { organizationId: orgId, kind: "rsvp-email", dedupeKey: { contains: ":reminder:" } },
      data: { status: "DONE" },
    });
    await at(runAt, () => fanout(event.id, event.startsAt, 60));
    for (const guest of [ava, ben]) {
      expect(
        (await reminderEmailJobs(guest.registrationId)).filter((j) => j.status === "PENDING"),
      ).toEqual([]);
    }
    expect((await sends(event.id)).map((s) => [s.channel, s.recipientKey]).sort()).toEqual(
      [
        ["email", `g:${ava.registrationId}`],
        ["email", `g:${ben.registrationId}`],
      ].sort(),
    );
  });

  it("reminds members who did not decline", async () => {
    if (!reachable) return;
    const event = await makeEvent({
      attendees: [
        [yes.id, "YES"],
        [maybe.id, "MAYBE"],
        [pending.id, "PENDING"],
        [declined.id, "NO"],
        [former.id, "YES"],
      ],
    });
    // Leaving the organization keeps the invitation row; it must not keep the reminders.
    await ownerDb.membership.deleteMany({ where: { organizationId: orgId, userId: former.id } });
    const runAt = new Date(event.startsAt.getTime() - HOUR);
    await at(runAt, () => fanout(event.id, event.startsAt, 60));
    await at(runAt, () => fanout(event.id, event.startsAt, 60));

    const sent = await reminders(event.id);
    expect(sent.map((n) => n.userId).sort()).toEqual([yes.id, maybe.id, pending.id].sort());
    expect(sent[0]).toMatchObject({
      title: "General meeting starts in an hour",
      linkUrl: `/app/${orgSlug}/meetings/${event.id}`,
      dedupeKey: `event-reminder:${event.id}:60:${minuteOf(event.startsAt)}`,
    });
    expect((await sends(event.id)).map((s) => [s.channel, s.recipientKey]).sort()).toEqual(
      [yes, maybe, pending].map((u) => ["app", `u:${u.id}`]).sort(),
    );
    // Each in-app reminder is emailed too, by the usual notify-email job.
    expect(
      await ownerDb.job.count({ where: { organizationId: orgId, kind: "notify-email" } }),
    ).toBeGreaterThanOrEqual(3);
  });

  it("member reminders carry the join link but never the host link", async () => {
    if (!reachable) return;
    const joinUrl = "https://us02web.zoom.us/j/81234567890?pwd=abc";
    const hostUrl = "https://us02web.zoom.us/s/81234567890?zak=host-secret";
    const event = await makeEvent({
      title: "Exec sync",
      format: "ONLINE",
      location: null,
      conferenceUrl: joinUrl,
      conferenceHostUrl: hostUrl,
      rsvp: true,
      attendees: [[yes.id, "YES"]],
    });
    const guest = await signUp(event.id, "Gia Online", `gia-online-${tag}@x.test`);
    const end = new Date(event.startsAt.getTime() + HOUR);

    await fanout(event.id, event.startsAt, 1440);
    const [note] = await reminders(event.id);
    expect(note).toMatchObject({ userId: yes.id, title: "Exec sync is tomorrow" });
    expect(note?.body).toBe(`${whenLine(event.startsAt, end, TZ, false)}\nJoin: ${joinUrl}`);
    expect(JSON.stringify(note)).not.toContain("zak=");
    expect(JSON.stringify(note)).not.toContain("/s/81234567890");

    // The guest's email has the join link too, and no host link either.
    await runReminderEmails([guest.registrationId]);
    const [mail] = mailTo(`gia-online-${tag}@x.test`);
    expect(mail?.text).toContain(joinUrl);
    expect(`${mail?.text}${mail?.html}`).not.toContain("zak=");
  });

  it("in-person member reminder has no Join line", async () => {
    if (!reachable) return;
    const event = await makeEvent({ location: "Curry 344", attendees: [[yes.id, "YES"]] });
    const end = new Date(event.startsAt.getTime() + HOUR);
    await fanout(event.id, event.startsAt, 60);
    const [note] = await reminders(event.id);
    expect(note?.body).toBe(`${whenLine(event.startsAt, end, TZ, false)}\nWhere: Curry 344`);
    expect(note?.body).not.toContain("Join");
  });

  it("a member who is also a guest gets both", async () => {
    if (!reachable) return;
    const event = await makeEvent({ rsvp: true, attendees: [[yes.id, "YES"]] });
    const guest = await signUp(event.id, "Yes Member", yes.email, yes.id);
    await fanout(event.id, event.startsAt, 60);
    await runReminderEmails([guest.registrationId]);

    expect((await reminders(event.id)).map((n) => n.userId)).toEqual([yes.id]);
    expect(mailTo(yes.email)).toHaveLength(1);
    expect((await sends(event.id)).map((s) => [s.channel, s.recipientKey]).sort()).toEqual(
      [
        ["app", `u:${yes.id}`],
        ["email", `g:${guest.registrationId}`],
      ].sort(),
    );
  });

  it("a removed reminder time sends nothing", async () => {
    if (!reachable) return;
    const event = await makeEvent({
      rsvp: true,
      reminderMinutes: [1440],
      attendees: [[yes.id, "YES"]],
    });
    const guest = await signUp(event.id, "Rae Removed", `rae-removed-${tag}@x.test`);
    await fanout(event.id, event.startsAt, 60);
    expect(await reminders(event.id)).toEqual([]);
    expect(await reminderEmailJobs(guest.registrationId)).toEqual([]);
  });
});

describe("moves, legacy jobs and failures", () => {
  it("a moved meeting reminds again for the new time, once", async () => {
    if (!reachable) return;
    const startsAt = new Date(Date.now() + 3 * DAY);
    const { event } = await asOwner((ctx) =>
      createEvent(ctx, input(startsAt, { reminderMinutes: [60] })),
    );
    await ownerDb.eventAttendee.create({
      data: { organizationId: orgId, eventId: event.id, userId: yes.id, rsvp: "YES" },
    });
    await ownerDb.event.update({
      where: { id: event.id },
      data: { rsvpEnabled: true, rsvpSlug: randomSlug() },
    });
    const guest = await signUp(event.id, "Mo Moved", `mo-moved-${tag}@x.test`);
    const email = `mo-moved-${tag}@x.test`;

    // The reminder for the first time goes out.
    const first = new Date(event.startsAt.getTime() - HOUR);
    await at(first, () => fanout(event.id, event.startsAt, 60));
    await at(first, () => runReminderEmails([guest.registrationId]));
    expect(await reminders(event.id)).toHaveLength(1);
    expect(mailTo(email)).toHaveLength(1);

    // Then the meeting moves a day later, which queues the new time's fanout.
    const moved = new Date(event.startsAt.getTime() + DAY);
    await asOwner((ctx) =>
      updateEvent(ctx, event.id, { startsAt: moved, endsAt: new Date(moved.getTime() + HOUR) }),
    );
    const [job] = (await fanoutJobs(event.id)).filter((j) =>
      j.dedupeKey.endsWith(`:${minuteOf(moved)}`),
    );
    expect(job?.runAt).toEqual(new Date(moved.getTime() - HOUR));

    // At its time it reminds everyone again: a second notification and email.
    const second = new Date(moved.getTime() - HOUR);
    await at(second, () => rsvpFanoutJob(run("rsvp-fanout", job!.payload as never)));
    await at(second, () => runReminderEmails([guest.registrationId]));
    const after = await reminders(event.id);
    expect(after.map((n) => n.dedupeKey)).toEqual([
      `event-reminder:${event.id}:60:${minuteOf(event.startsAt)}`,
      `event-reminder:${event.id}:60:${minuteOf(moved)}`,
    ]);
    expect(mailTo(email)).toHaveLength(2);

    // Run again (a retry, a lost lease): no third of either.
    await at(second, () => rsvpFanoutJob(run("rsvp-fanout", job!.payload as never)));
    await at(second, () => runReminderEmails([guest.registrationId]));
    expect(await reminders(event.id)).toHaveLength(2);
    expect(mailTo(email)).toHaveLength(2);
    expect((await sends(event.id)).map((s) => [s.channel, s.recipientKey]).sort()).toEqual(
      [
        ["app", `u:${yes.id}`],
        ["email", `g:${guest.registrationId}`],
      ].sort(),
    );
  });

  it("the old time's fanout sends nothing after a move", async () => {
    if (!reachable) return;
    const startsAt = new Date(Date.now() + 3 * DAY);
    const { event } = await asOwner((ctx) =>
      createEvent(ctx, input(startsAt, { reminderMinutes: [60] })),
    );
    await ownerDb.eventAttendee.create({
      data: { organizationId: orgId, eventId: event.id, userId: yes.id, rsvp: "YES" },
    });
    await ownerDb.event.update({
      where: { id: event.id },
      data: { rsvpEnabled: true, rsvpSlug: randomSlug() },
    });
    const guest = await signUp(event.id, "Old Time", `old-time-${tag}@x.test`);
    const [oldJob] = await fanoutJobs(event.id);
    expect(oldJob?.payload).toMatchObject({ startsAt: event.startsAt.toISOString() });
    // A guest's email the old fanout queued before the move, still waiting.
    await withSystemOrgTx(orgId, ({ db }) =>
      enqueueRsvpEmails(db, orgId, [guest.registrationId], "reminder", {
        startsAt: event.startsAt,
        offsetMinutes: 60,
      }),
    );
    const [oldEmail] = await reminderEmailJobs(guest.registrationId);

    const moved = new Date(event.startsAt.getTime() + DAY);
    await asOwner((ctx) =>
      updateEvent(ctx, event.id, { startsAt: moved, endsAt: new Date(moved.getTime() + HOUR) }),
    );

    const oldTime = new Date(event.startsAt.getTime() - HOUR);
    expect(
      await at(oldTime, () => rsvpFanoutJob(run("rsvp-fanout", oldJob!.payload as never))),
    ).toEqual({
      status: "DONE",
    });
    expect(
      await at(oldTime, () => rsvpEmailJob(run("rsvp-email", oldEmail!.payload as never))),
    ).toEqual({
      status: "DONE",
    });
    expect(await reminders(event.id)).toEqual([]);
    expect(mailerSend).not.toHaveBeenCalled();
    expect(await sends(event.id)).toEqual([]);
    expect(await reminderEmailJobs(guest.registrationId)).toHaveLength(1);
  });

  it('a legacy stage "day" payload reminds as 1440', async () => {
    if (!reachable) return;
    const event = await makeEvent({ rsvp: true, attendees: [[yes.id, "YES"]] });
    const guest = await signUp(event.id, "Lee Legacy", `lee-legacy-${tag}@x.test`);
    const minute = minuteOf(event.startsAt);
    await rsvpFanoutJob(
      run("rsvp-fanout", {
        eventId: event.id,
        stage: "day" as const,
        startsAt: event.startsAt.toISOString(),
      }),
    );
    expect(await reminders(event.id)).toEqual([
      expect.objectContaining({
        userId: yes.id,
        title: "General meeting is tomorrow",
        dedupeKey: `event-reminder:${event.id}:1440:${minute}`,
      }),
    ]);
    // The guest's email is queued in the new form.
    expect((await reminderEmailJobs(guest.registrationId)).map((j) => j.dedupeKey)).toEqual([
      `rsvp-email:${guest.registrationId}:reminder:r1440:${minute}`,
    ]);

    // A legacy "reminder-hour" email still waiting is sent as the hour reminder.
    await rsvpEmailJob(
      run("rsvp-email", {
        registrationId: guest.registrationId,
        template: "reminder-hour" as const,
        startsAt: event.startsAt.toISOString(),
      }),
    );
    const mail = mailTo(`lee-legacy-${tag}@x.test`);
    expect(mail.map((m) => m.subject)).toEqual(["Starting in an hour: General meeting"]);
    expect((await sends(event.id)).map((s) => [s.offsetMinutes, s.channel]).sort()).toEqual(
      [
        [1440, "app"],
        [60, "email"],
      ].sort(),
    );
  });

  it("a failed send releases the claim so the retry sends", async () => {
    if (!reachable) return;
    const event = await makeEvent({ rsvp: true });
    const guest = await signUp(event.id, "Fay Failed", `fay-failed-${tag}@x.test`);
    await fanout(event.id, event.startsAt, 60);
    const [job] = await reminderEmailJobs(guest.registrationId);

    mailerSend.mockRejectedValueOnce(new Error("provider down"));
    await expect(rsvpEmailJob(run("rsvp-email", job!.payload as never))).rejects.toThrow(
      "provider down",
    );
    expect(await sends(event.id)).toEqual([]);

    await rsvpEmailJob(run("rsvp-email", job!.payload as never));
    expect(mailTo(`fay-failed-${tag}@x.test`)).toHaveLength(2);
    expect((await sends(event.id)).map((s) => [s.channel, s.recipientKey])).toEqual([
      ["email", `g:${guest.registrationId}`],
    ]);
  });
});
