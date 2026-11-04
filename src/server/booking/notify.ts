import { NotificationType } from "@/generated/prisma/enums";
import { safeTimeZone } from "@/lib/calendar/dates";
import type { TxClient } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";
import { notifyUsers } from "@/server/notifications";

/**
 * Who hears about a booking (docs/features/booking.md, "Nobody misses a
 * call"): the host in their Inbox (MEETING_BOOKED; the notify-email job
 * emails it too, per their preferences), and the guest by email through
 * the booking-email job, queued in the same transaction, so a booking that
 * rolls back tells nobody and one that commits is told even when sending
 * fails a few times first (the job retries; the Inbox line and the
 * calendar event are already there either way).
 */

export type GuestTemplate = "booked" | "moved" | "cancelled" | "reminder" | "host-changed";

/** "Tuesday, November 10, 3:00 PM EST" in `tz`. */
export function whenText(at: Date, tz: string): string {
  return at.toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: safeTimeZone(tz),
    timeZoneName: "short",
  });
}

export async function tellHosts(
  db: TxClient,
  organizationId: string,
  userIds: readonly string[],
  input: { title: string; body?: string | null; eventId: string | null; key: string; actorId?: string | null },
): Promise<void> {
  const to = [...new Set(userIds)].filter((u) => u && u !== input.actorId);
  if (to.length === 0) return;
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { slug: true } });
  await notifyUsers(db, organizationId, to, {
    type: NotificationType.MEETING_BOOKED,
    title: input.title,
    body: input.body ?? null,
    linkUrl: org
      ? input.eventId
        ? `/app/${org.slug}/meetings/${input.eventId}`
        : `/app/${org.slug}/meetings/booking`
      : null,
    actorId: input.actorId ?? null,
    dedupeKey: `booking:${input.key}`,
  });
}

/** One email to the guest, queued (the job reads everything fresh and sends only what's still true). */
export async function emailGuest(
  db: TxClient,
  organizationId: string,
  bookingId: string,
  template: GuestTemplate,
  extra: { startsAt: Date; offsetMinutes?: number },
): Promise<void> {
  const startMinute = Math.floor(extra.startsAt.getTime() / 60_000);
  await enqueueJob(db, {
    orgId: organizationId,
    kind: "booking-email",
    key: `${bookingId}:${template}${extra.offsetMinutes ? `:r${extra.offsetMinutes}` : ""}:${startMinute}`,
    payload: {
      bookingId,
      template,
      startsAt: extra.startsAt.toISOString(),
      ...(extra.offsetMinutes ? { offsetMinutes: extra.offsetMinutes } : {}),
    },
  });
}
