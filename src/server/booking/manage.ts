import type { Role } from "@/generated/prisma/client";
import { can } from "@/lib/auth/permissions";
import { withSystemOrgTx, type MemberContext, type TxClient } from "@/server/db/context";
import { ConflictError } from "@/server/db/errors";
import { updateEvent } from "@/server/events/service";

import { cancelBooking, moveBooking } from "./book";
import { emailGuest, tellHosts, whenText } from "./notify";
import { pageTimeZone, slotsFor } from "./slots";

/**
 * The host's side of a booking, and keeping a booking true to its meeting
 * (docs/features/booking.md). A member reads bookings through RLS (their
 * own, or all of them as an owner or admin); every write happens on the
 * service path after that read said they may.
 */

export class BookingActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookingActionError";
  }
}

/** The booking, if this member may act on it (RLS: its host, or an owner or admin). */
async function readable(ctx: MemberContext, bookingId: string) {
  const b = await ctx.db.booking.findFirst({
    where: { id: bookingId, organizationId: ctx.organizationId },
    select: { id: true, hostUserId: true, status: true, needsHost: true },
  });
  if (!b) throw new BookingActionError("That booking isn't here any more.");
  return b;
}

/** The host (or an owner or admin) cancels; the guest is told, with the note. */
export async function hostCancel(ctx: MemberContext, bookingId: string, note: string): Promise<void> {
  await readable(ctx, bookingId);
  await withSystemOrgTx(ctx.organizationId, { userId: ctx.userId }, async ({ db }) => {
    const b = await db.booking.findFirst({ where: { id: bookingId, organizationId: ctx.organizationId }, include: { page: true } });
    if (!b || b.status !== "BOOKED") return;
    await cancelBooking(db, b, "host", note, ctx.userId);
  });
}

/** An owner or admin takes a booking whose host left (or any booking, to cover it). */
export async function takeBooking(ctx: MemberContext, bookingId: string): Promise<void> {
  await readable(ctx, bookingId);
  if (!can(ctx, "settings.general.write")) throw new BookingActionError("Owners and admins hand bookings over.");
  try {
    await withSystemOrgTx(ctx.organizationId, { userId: ctx.userId }, async ({ db }) => {
      const b = await db.booking.findFirst({ where: { id: bookingId, organizationId: ctx.organizationId }, include: { page: true } });
      if (!b || b.status !== "BOOKED") return;
      await reassign(db, b, ctx.userId, ctx.role);
    });
  } catch (error) {
    // The unique (host, start) index: they already have a booked meeting then.
    if (error instanceof ConflictError) throw new BookingActionError("You already have a meeting booked at that time.");
    throw error;
  }
}

async function reassign(
  db: TxClient,
  b: { id: string; organizationId: string; eventId: string; startsAt: Date; hostUserId: string },
  to: string,
  role: Role | null,
): Promise<void> {
  await db.booking.update({ where: { id: b.id }, data: { hostUserId: to, needsHost: false } });
  const live = await db.event.findFirst({ where: { id: b.eventId, organizationId: b.organizationId, deletedAt: null }, select: { id: true } });
  if (live) {
    await updateEvent({ db, organizationId: b.organizationId, userId: to, role, kind: "system" }, b.eventId, { hostUserId: to });
    await db.eventAttendee.upsert({
      where: { eventId_userId: { eventId: b.eventId, userId: to } },
      create: { organizationId: b.organizationId, eventId: b.eventId, userId: to, rsvp: "YES" },
      update: { rsvp: "YES" },
    });
  }
  await emailGuest(db, b.organizationId, b.id, "host-changed", { startsAt: b.startsAt });
}

/**
 * booking-sync:{eventId}: the meeting was moved or deleted somewhere else
 * (the calendar, the meeting's page, an import). Bring the booking along
 * and tell the guest; a change the booking code made itself already
 * matches and does nothing here.
 */
export async function syncBookingToEvent(organizationId: string, eventId: string): Promise<void> {
  await withSystemOrgTx(organizationId, async ({ db }) => {
    const b = await db.booking.findFirst({ where: { organizationId, eventId }, include: { page: true } });
    if (!b || b.status !== "BOOKED") return;
    const e = await db.event.findFirst({
      where: { id: eventId, organizationId },
      select: { deletedAt: true, startsAt: true, endsAt: true },
    });
    if (!e || e.deletedAt) {
      await cancelBooking(db, b, "host", "", null);
      return;
    }
    if (e.startsAt.getTime() !== b.startsAt.getTime() || e.endsAt.getTime() !== b.endsAt.getTime()) {
      await moveBooking(db, b, e.startsAt, e.endsAt, "host", null, false);
    }
  });
}

/**
 * booking-host-left:{userId}: a member left. Each of their upcoming
 * bookings goes to another host of the same organization link who is free
 * then (round-robin's first pick), with the guest told who they'll meet;
 * a booking nobody can take is flagged "Needs a host" in Meeting links and
 * every owner and admin is told in their Inbox. Nothing is left without
 * someone seeing it.
 */
export async function bookingHostLeft(organizationId: string, userId: string, now: Date = new Date()): Promise<void> {
  await withSystemOrgTx(organizationId, async ({ db }) => {
    const still = await db.membership.findFirst({ where: { organizationId, userId }, select: { userId: true } });
    if (still) return;
    const upcoming = await db.booking.findMany({
      where: { organizationId, hostUserId: userId, status: "BOOKED", startsAt: { gt: now } },
      include: { page: true },
      orderBy: { startsAt: "asc" },
      take: 500,
    });
    if (upcoming.length === 0) return;
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
    const admins = (
      await db.membership.findMany({ where: { organizationId, role: { in: ["OWNER", "ADMIN"] } }, select: { userId: true } })
    ).map((m) => m.userId);
    for (const b of upcoming) {
      let moved = false;
      const tz = pageTimeZone(b.page, org?.timezone ?? "UTC");
      if (!b.page.ownerUserId && b.page.hostIds.length > 0) {
        const durationMin = Math.round((b.endsAt.getTime() - b.startsAt.getTime()) / 60_000);
        const slot = (
          // Notice and how far ahead were for the guest; covering a booked meeting ignores them.
          await slotsFor(db, { ...b.page, minNoticeHours: 0, maxDaysAhead: 90 }, tz, now, {
            durationMin,
            exceptBookingId: b.id,
            from: b.startsAt,
            to: b.endsAt,
          })
        ).find((s) => s.start.getTime() === b.startsAt.getTime());
        const to = slot?.hostIds.find((h) => h !== userId);
        if (to) {
          const role = (await db.membership.findFirst({ where: { organizationId, userId: to }, select: { role: true } }))?.role ?? null;
          await reassign(db, b, to, role);
          await tellHosts(db, organizationId, [to], {
            title: `${b.guestName} is yours now: ${b.page.title}`,
            body: `${whenText(b.startsAt, tz)}. Their host left the organization.`,
            eventId: b.eventId,
            key: `${b.id}:handover:${to}`,
          });
          moved = true;
        }
      }
      if (!moved) {
        await db.booking.update({ where: { id: b.id }, data: { needsHost: true } });
        await tellHosts(db, organizationId, admins, {
          title: `${b.guestName}'s meeting needs a host`,
          body: `${b.page.title}, ${whenText(b.startsAt, tz)}. Its host left the organization. Take it or cancel it in Meeting links.`,
          eventId: null,
          key: `${b.id}:needs-host`,
        });
      }
    }
  });
}

/** In the reminder fan-out: queue each booked guest's reminder for this offset (the email job claims it once). */
export async function queueGuestReminders(
  db: TxClient,
  organizationId: string,
  eventId: string,
  offset: number,
  startsAt: Date,
): Promise<number> {
  const b = await db.booking.findFirst({
    where: { organizationId, eventId, status: "BOOKED", startsAt },
    select: { id: true, remindedOffsets: true },
  });
  if (!b || (b.remindedOffsets ?? []).includes(offset)) return 0;
  await emailGuest(db, organizationId, b.id, "reminder", { startsAt, offsetMinutes: offset });
  return 1;
}
