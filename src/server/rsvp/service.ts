import { randomInt } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { placeRegistration, promotableCount, type ClosedReason } from "@/lib/rsvp/format";
import { enqueueJob, prepareJob, type EnqueueInput } from "@/server/jobs/enqueue";

/**
 * Public RSVP pages: sign-ups, the waitlist and reminders
 * (docs/features/rsvp.md). Every function runs in the caller's transaction:
 * the public page's service transaction (withSystemOrgTx, the event's org)
 * or an owner/admin's own (withOrgTx; RLS lets only them touch sign-ups).
 *
 * Anything that counts spots first takes the event's advisory lock, so two
 * people pressing Register for the last spot can't both get it; the loser
 * lands on the waitlist (or is told it's full).
 */

type Db = Prisma.TransactionClient;

/** What the rules need from the event. */
export const RSVP_RULES_SELECT = {
  id: true,
  organizationId: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  deletedAt: true,
  rsvpEnabled: true,
  rsvpSlug: true,
  rsvpCapacity: true,
  rsvpWaitlist: true,
  rsvpClosed: true,
  rsvpCostMode: true,
  rsvpCostCents: true,
} satisfies Prisma.EventSelect;

export type RsvpRulesEvent = Prisma.EventGetPayload<{ select: typeof RSVP_RULES_SELECT }>;

/**
 * The emails a guest gets. A "reminder" goes out at each of the meeting's
 * reminder offsets (Event.reminderMinutes). The email job still reads the
 * "reminder-day" and "reminder-hour" payloads queued before offsets existed
 * (src/server/rsvp/jobs.ts), but nothing queues those any more.
 */
export type RsvpEmailTemplate =
  "registered" | "waitlisted" | "promoted" | "reminder" | "event-cancelled";

/** Serializes everything that counts this event's spots, until commit. */
export async function lockEvent(db: Db, eventId: string): Promise<void> {
  // $executeRaw: the function returns void, which $queryRaw can't read back.
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`rsvp:${eventId}`}, 0))`;
}

export async function registrationCounts(
  db: Db,
  organizationId: string,
  eventId: string,
): Promise<{ going: number; waitlist: number }> {
  const rows = await db.eventRegistration.groupBy({
    by: ["status"],
    where: { organizationId, eventId, status: { in: ["GOING", "WAITLIST"] } },
    _count: { _all: true },
  });
  const of = (s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
  return { going: of("GOING"), waitlist: of("WAITLIST") };
}

type RsvpEmailOptions = {
  /** Reminders: the start they are for, so a moved event's are skipped. */
  startsAt?: Date;
  /** Reminders: how many minutes before the start. */
  offsetMinutes?: number;
  dedupe?: string;
};

function rsvpEmailJob(
  organizationId: string,
  registrationId: string,
  template: RsvpEmailTemplate,
  options: RsvpEmailOptions,
): EnqueueInput<"rsvp-email"> {
  const offset = options.offsetMinutes ? `:r${options.offsetMinutes}` : "";
  const stamp = options.startsAt ? `:${Math.floor(options.startsAt.getTime() / 60_000)}` : "";
  return {
    orgId: organizationId,
    kind: "rsvp-email",
    key: `${registrationId}:${template}${offset}${stamp}${options.dedupe ? `:${options.dedupe}` : ""}`,
    payload: {
      registrationId,
      template,
      ...(options.offsetMinutes ? { offsetMinutes: options.offsetMinutes } : {}),
      ...(options.startsAt ? { startsAt: options.startsAt.toISOString() } : {}),
    },
  };
}

export async function enqueueRsvpEmail(
  db: Db,
  organizationId: string,
  registrationId: string,
  template: RsvpEmailTemplate,
  options: RsvpEmailOptions = {},
): Promise<void> {
  await enqueueJob(db, rsvpEmailJob(organizationId, registrationId, template, options));
}

/**
 * enqueueRsvpEmail for many guests in two round trips however many there
 * are: the same keys, payloads and checks, with app.enqueue_job run once
 * per guest inside the database. A big event's reminders then fit in the
 * fan-out's short transaction, where a round trip per guest would time out.
 * Returns how many it queued.
 */
export async function enqueueRsvpEmails(
  db: Db,
  organizationId: string,
  registrationIds: readonly string[],
  template: RsvpEmailTemplate,
  options: { startsAt?: Date; offsetMinutes?: number } = {},
): Promise<number> {
  const [first, ...rest] = registrationIds;
  if (!first) return 0;
  // The first goes through enqueueJob, which also wakes the job drain after
  // commit (so a "spot opened" email goes out in seconds); the rest follow
  // in one statement.
  await enqueueJob(db, rsvpEmailJob(organizationId, first, template, options));
  if (rest.length === 0) return 1;
  const jobs = rest.map((id) => prepareJob(rsvpEmailJob(organizationId, id, template, options)));
  const rows = await db.$queryRaw<{ n: number }[]>`
    SELECT count(app.enqueue_job(
      ${organizationId}, 'rsvp-email', t.key, t.payload::jsonb,
      NULL::timestamp, ${jobs[0]!.maxAttempts}::int, false
    ))::int AS n
      FROM unnest(
        ${jobs.map((j) => j.dedupeKey)}::text[], ${jobs.map((j) => j.payloadJson)}::text[]
      ) AS t(key, payload)`;
  return 1 + (rows[0]?.n ?? 0);
}

export type RegisterOutcome =
  | { kind: "registered"; registrationId: string; status: "GOING" | "WAITLIST" }
  /** That email already has a live sign-up: we email its owner, not the visitor. */
  | { kind: "exists" }
  | { kind: "closed"; reason: ClosedReason | "off" };

/**
 * A sign-up from the public page (or an admin's "Add guest"). An email
 * that cancelled before signs up again on the same row; one that's still
 * signed up gets its confirmation re-sent (at most hourly), and the visitor
 * is only told to check that inbox, so typing someone else's email reveals
 * nothing and takes nothing over.
 */
export async function registerGuest(
  db: Db,
  event: RsvpRulesEvent,
  guest: {
    name: string;
    email: string;
    phone: string;
    /** Instagram handle without the @; null when they left it blank. */
    instagram?: string | null;
    userId?: string | null;
  },
  options: {
    now?: Date;
    force?: boolean;
    /** The invite code in the link they came from (?via=). */
    via?: string | null;
  } = {},
): Promise<RegisterOutcome> {
  const now = options.now ?? new Date();
  if (!event.rsvpEnabled || event.deletedAt) return { kind: "closed", reason: "off" };
  await lockEvent(db, event.id);

  const existing = await db.eventRegistration.findUnique({
    where: { eventId_email: { eventId: event.id, email: guest.email } },
    select: { id: true, status: true, invitedById: true },
  });
  if (existing && existing.status !== "CANCELLED") {
    await enqueueRsvpEmail(
      db,
      event.organizationId,
      existing.id,
      existing.status === "GOING" ? "registered" : "waitlisted",
      { dedupe: `again-${now.toISOString().slice(0, 13).replace(/\D/g, "")}` },
    );
    return { kind: "exists" };
  }

  const { going } = await registrationCounts(db, event.organizationId, event.id);
  const placed = options.force
    ? ({ status: "GOING" } as const)
    : placeRegistration(
        { capacity: event.rsvpCapacity, waitlist: event.rsvpWaitlist, closed: event.rsvpClosed },
        going,
        event.endsAt <= now,
      );
  if ("closed" in placed) return { kind: "closed", reason: placed.closed };

  const inviter = await findInviter(db, event, options.via);
  const data = {
    name: guest.name,
    phone: guest.phone,
    instagram: guest.instagram ?? null,
    status: placed.status,
    userId: guest.userId ?? null,
    // A sign-up after cancelling goes to the back of the line.
    queuedAt: now,
    cancelledAt: null,
    checkedInAt: null,
  };
  const row = existing
    ? await db.eventRegistration.update({
        where: { id: existing.id },
        // Whoever first brought them keeps the credit.
        data: {
          ...data,
          ...(existing.invitedById || !inviter || inviter === existing.id
            ? {}
            : { invitedById: inviter }),
        },
        select: { id: true },
      })
    : await db.eventRegistration.create({
        data: {
          ...data,
          organizationId: event.organizationId,
          eventId: event.id,
          email: guest.email,
          inviteCode: generateRsvpCode(INVITE_CODE_LENGTH),
          ticketCode: generateRsvpCode(TICKET_CODE_LENGTH),
          invitedById: inviter,
        },
        select: { id: true },
      });
  await enqueueRsvpEmail(
    db,
    event.organizationId,
    row.id,
    placed.status === "GOING" ? "registered" : "waitlisted",
    { dedupe: now.getTime().toString(36) },
  );
  return { kind: "registered", registrationId: row.id, status: placed.status };
}

/**
 * Moves the guests longest in line (queuedAt) into open spots (all of them
 * when the event is unlimited) and emails each "you're in". Call under the
 * event's lock, after anything that frees a spot or adds capacity. `skipId`
 * stays where it is: the guest a host just moved off the going list.
 */
export async function promoteFromWaitlist(
  db: Db,
  event: RsvpRulesEvent,
  skipId?: string,
): Promise<number> {
  const { going, waitlist } = await registrationCounts(db, event.organizationId, event.id);
  const waiting = skipId ? waitlist - 1 : waitlist;
  const n = event.endsAt <= new Date() ? 0 : promotableCount(event.rsvpCapacity, going, waiting);
  if (n === 0) return 0;
  const ids = (
    await db.eventRegistration.findMany({
      where: {
        organizationId: event.organizationId,
        eventId: event.id,
        status: "WAITLIST",
        ...(skipId ? { id: { not: skipId } } : {}),
      },
      orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
      take: n,
      select: { id: true },
    })
  ).map((r) => r.id);
  await db.eventRegistration.updateMany({
    where: { organizationId: event.organizationId, eventId: event.id, id: { in: ids } },
    data: { status: "GOING", queuedAt: new Date() },
  });
  await enqueueRsvpEmails(db, event.organizationId, ids, "promoted");
  return ids.length;
}

/**
 * Sets a sign-up's status (the guest cancelling, or an admin moving them).
 * An admin may put someone on the going list past capacity. A spot freed
 * by a cancellation, or by a host moving a guest to the waitlist, goes to
 * whoever is next in line. Cancelling also lets go of the guest's bring
 * list lines.
 */
export async function setRegistrationStatus(
  db: Db,
  event: RsvpRulesEvent,
  registrationId: string,
  status: "GOING" | "WAITLIST" | "CANCELLED",
): Promise<boolean> {
  await lockEvent(db, event.id);
  const row = await db.eventRegistration.findFirst({
    where: { id: registrationId, organizationId: event.organizationId, eventId: event.id },
    select: { id: true, status: true },
  });
  if (!row) return false;
  if (row.status === status) return true;
  const now = new Date();
  await db.eventRegistration.update({
    where: { id: row.id },
    data:
      status === "CANCELLED"
        ? { status, cancelledAt: now }
        : // Joining a list puts them at its end (the waitlist moves up in this order).
          { status, cancelledAt: null, queuedAt: now },
  });
  if (status === "CANCELLED") {
    // Their bring list lines open up for someone else.
    await db.rsvpItemClaim.deleteMany({
      where: { organizationId: event.organizationId, registrationId: row.id },
    });
  }
  if (row.status === "WAITLIST" && status === "GOING") {
    await enqueueRsvpEmail(db, event.organizationId, row.id, "promoted");
  }
  // A freed spot never sits empty while people wait. The guest a host moved
  // to the waitlist joins the back of the line and is skipped here, so the
  // spot doesn't bounce straight back to them with a "spot opened" email; a
  // host who wants someone particular in moves that guest to going.
  if (row.status === "GOING" && status !== "GOING") {
    await promoteFromWaitlist(db, event, status === "WAITLIST" ? row.id : undefined);
  }
  return true;
}

/**
 * The shortest reminder an all-day event gets: anything under a day before
 * its midnight start lands the evening before (an hour before is 11 PM).
 */
export const ALL_DAY_MIN_REMINDER_MINUTES = 1440;

/**
 * Queues one reminder fanout (rsvp-fanout) per offset in the meeting's
 * reminderMinutes, each to run at the start minus that offset. One fanout
 * reminds members and public guests alike (src/server/rsvp/jobs.ts).
 *
 * - The job key carries the offset and the start, so moving the event
 *   queues new ones and the old ones find the time changed and do nothing.
 *   Scheduling the same start again merges into the job already waiting, so
 *   any caller may call this whenever who or when might have changed.
 * - A reminder whose moment has already passed is skipped (people who sign
 *   up that late just got their confirmation).
 * - An all-day event skips offsets under a day.
 *
 * Returns how many it queued.
 */
export async function scheduleEventReminders(
  db: Db,
  event: {
    id: string;
    organizationId: string;
    startsAt: Date;
    allDay: boolean;
    reminderMinutes: number[];
  },
  now: Date = new Date(),
): Promise<number> {
  const startMinute = Math.floor(event.startsAt.getTime() / 60_000);
  let queued = 0;
  for (const offset of new Set(event.reminderMinutes)) {
    if (event.allDay && offset < ALL_DAY_MIN_REMINDER_MINUTES) continue;
    const runAt = new Date(event.startsAt.getTime() - offset * 60_000);
    if (runAt <= now) continue;
    await enqueueJob(db, {
      orgId: event.organizationId,
      kind: "rsvp-fanout",
      key: `${event.id}:r${offset}:${startMinute}`,
      payload: {
        eventId: event.id,
        stage: "reminder",
        offsetMinutes: offset,
        startsAt: event.startsAt.toISOString(),
      },
      runAt,
    });
    queued++;
  }
  return queued;
}

/**
 * Tells everyone still signed up that the event is off (it was deleted). A
 * job does the fan-out on the service path, so it works whoever deleted it
 * (RLS shows sign-ups only to owners and admins).
 */
export async function notifyEventCancelled(
  db: Db,
  organizationId: string,
  eventId: string,
): Promise<void> {
  await enqueueJob(db, {
    orgId: organizationId,
    kind: "rsvp-fanout",
    key: `${eventId}:cancelled`,
    payload: { eventId, stage: "cancelled" },
  });
}

const SLUG_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/** Lowercase letters and digits with no look-alikes (l, o, 0, 1). */
export function generateRsvpCode(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += SLUG_ALPHABET[randomInt(SLUG_ALPHABET.length)];
  return out;
}

/** A page code: 8 characters. */
export function generateRsvpSlug(): string {
  return generateRsvpCode(8);
}

/** A guest's invite link code (unique per event). */
export const INVITE_CODE_LENGTH = 8;
/** A ticket's code (unique everywhere; 32^12 makes guessing one hopeless). */
export const TICKET_CODE_LENGTH = 12;

/** The sign-up behind an invite code on this event, if it is still signed up. */
async function findInviter(
  db: Db,
  event: RsvpRulesEvent,
  via: string | null | undefined,
): Promise<string | null> {
  if (!via || !/^[a-z0-9]{6,12}$/.test(via)) return null;
  const row = await db.eventRegistration.findFirst({
    where: {
      organizationId: event.organizationId,
      eventId: event.id,
      inviteCode: via,
      status: { in: ["GOING", "WAITLIST"] },
    },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * Turns an event's RSVP page on, giving it its link the first time (kept
 * after that, so a shared link survives turning the page off and on), and
 * queues the reminders. Returns the code.
 */
export async function enableRsvpPage(
  db: Db,
  organizationId: string,
  eventId: string,
): Promise<string> {
  const current = await db.event.findFirstOrThrow({
    where: { id: eventId, organizationId },
    select: { rsvpSlug: true },
  });
  let slug = current.rsvpSlug;
  for (let attempt = 0; !slug; attempt++) {
    const candidate = generateRsvpSlug();
    // A savepoint, so a code another page already has (1 in 10^12) doesn't
    // abort the whole transaction.
    await db.$executeRaw`SAVEPOINT rsvp_slug`;
    try {
      await db.event.update({ where: { id: eventId }, data: { rsvpSlug: candidate } });
      await db.$executeRaw`RELEASE SAVEPOINT rsvp_slug`;
      slug = candidate;
    } catch (error) {
      await db.$executeRaw`ROLLBACK TO SAVEPOINT rsvp_slug`;
      const taken = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
      if (!taken || attempt >= 4) throw error;
    }
  }
  const updated = await db.event.update({
    where: { id: eventId },
    data: { rsvpEnabled: true },
    select: { id: true, organizationId: true, startsAt: true, allDay: true, reminderMinutes: true },
  });
  await scheduleEventReminders(db, updated);
  return slug;
}

// ---- The bring list ---------------------------------------------------------

export interface RsvpItemInput {
  /** Set for an existing line; new lines have none. */
  id?: string;
  label: string;
  slots: number;
}

/**
 * Replaces the event's bring list with `items`, in order: lines left out
 * are deleted (with who was bringing them), existing lines are renamed or
 * resized in place, and new lines are added. Lowering a line's slots below
 * the people already bringing it keeps them all.
 */
export async function saveRsvpItems(
  db: Db,
  event: { id: string; organizationId: string },
  items: readonly RsvpItemInput[],
): Promise<void> {
  await lockEvent(db, event.id);
  const where = { organizationId: event.organizationId, eventId: event.id };
  const keep = items.map((i) => i.id).filter((id): id is string => Boolean(id));
  await db.rsvpItem.deleteMany({ where: { ...where, id: { notIn: keep } } });
  const existing = new Set(
    (await db.rsvpItem.findMany({ where, select: { id: true } })).map((i) => i.id),
  );
  for (const [position, item] of items.entries()) {
    if (item.id && existing.has(item.id)) {
      await db.rsvpItem.update({
        where: { id: item.id },
        data: { label: item.label, slots: item.slots, position },
      });
    } else {
      await db.rsvpItem.create({
        data: { ...where, label: item.label, slots: item.slots, position },
      });
    }
  }
}

export type ClaimOutcome = "ok" | "full" | "gone";

/**
 * A signed-up guest takes a bring list line (or puts it back). Taking one
 * counts its claims under the event's lock, so two guests can't both take
 * the last slot.
 */
export async function setItemClaim(
  db: Db,
  event: { id: string; organizationId: string },
  registrationId: string,
  itemId: string,
  claim: boolean,
): Promise<ClaimOutcome> {
  await lockEvent(db, event.id);
  // Sequential: one connection per transaction.
  const item = await db.rsvpItem.findFirst({
    where: { id: itemId, organizationId: event.organizationId, eventId: event.id },
    select: { id: true, slots: true, _count: { select: { claims: true } } },
  });
  const reg = await db.eventRegistration.findFirst({
    where: {
      id: registrationId,
      organizationId: event.organizationId,
      eventId: event.id,
      status: { in: ["GOING", "WAITLIST"] },
    },
    select: { id: true },
  });
  if (!item || !reg) return "gone";
  const key = { itemId_registrationId: { itemId: item.id, registrationId: reg.id } };
  if (!claim) {
    await db.rsvpItemClaim.deleteMany({ where: { itemId: item.id, registrationId: reg.id } });
    return "ok";
  }
  if (await db.rsvpItemClaim.findUnique({ where: key, select: { itemId: true } })) return "ok";
  if (item._count.claims >= item.slots) return "full";
  await db.rsvpItemClaim.create({
    data: { organizationId: event.organizationId, itemId: item.id, registrationId: reg.id },
  });
  return "ok";
}

// ---- Split the cost ---------------------------------------------------------

/**
 * A guest going to the event says they paid `cents` (their share when they
 * pressed it). Saying it again updates the amount; a host's confirmation
 * stays.
 */
export async function claimPayment(
  db: Db,
  event: { id: string; organizationId: string },
  registrationId: string,
  cents: number,
  now: Date = new Date(),
): Promise<boolean> {
  const done = await db.eventRegistration.updateMany({
    where: {
      id: registrationId,
      organizationId: event.organizationId,
      eventId: event.id,
      status: "GOING",
    },
    data: { paidCents: cents, paidClaimedAt: now },
  });
  return done.count > 0;
}

/**
 * A host marks a guest paid (confirming what they said, or cash at the
 * door, recorded at `fallbackCents` when the guest never said) or unpaid.
 */
export async function confirmPayment(
  db: Db,
  event: { id: string; organizationId: string },
  registrationId: string,
  paid: boolean,
  fallbackCents: number | null,
  now: Date = new Date(),
): Promise<boolean> {
  const row = await db.eventRegistration.findFirst({
    where: { id: registrationId, organizationId: event.organizationId, eventId: event.id },
    select: { id: true, paidCents: true },
  });
  if (!row) return false;
  await db.eventRegistration.update({
    where: { id: row.id },
    data: paid
      ? { paidConfirmedAt: now, paidCents: row.paidCents ?? fallbackCents }
      : { paidConfirmedAt: null, paidClaimedAt: null, paidCents: null },
  });
  return true;
}
