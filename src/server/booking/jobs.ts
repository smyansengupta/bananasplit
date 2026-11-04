import { appUrl } from "@/lib/app-url";
import { withSystemOrgTx } from "@/server/db/context";
import { getOrgMailer, getPlatformMailer, resolveOrgMailRouting } from "@/server/email/mailer";
import { PermanentJobError, type JobHandler, type JobOutcome } from "@/server/jobs/types";

import { guestEmail } from "./emails";
import { bookingHostLeft, syncBookingToEvent } from "./manage";
import { whenText, type GuestTemplate } from "./notify";
import { pageTimeZone } from "./slots";
import { bookingToken } from "./token";

/**
 * The booking jobs (registry rows booking-email, booking-sync and
 * booking-host-left). Same contract as the other email jobs: short service
 * transactions to read and to mark, the send with no transaction open.
 *
 * Who it's from: the organization's own verified sender when it has one,
 * else Bananasplit's own (the platform sender, as itself). Never "<Org> via
 * Bananasplit" and never the host's name: the address was typed by
 * whoever booked, so nothing here may read as the organization or the host
 * writing to a stranger.
 */

function requireOrg(orgId: string | null): string {
  if (!orgId) throw new PermanentJobError("org job without an organizationId");
  return orgId;
}

interface EmailPayload {
  bookingId: string;
  template: GuestTemplate;
  startsAt: string;
  offsetMinutes?: number;
}

export const bookingEmailJob: JobHandler<EmailPayload> = async (run): Promise<JobOutcome | void> => {
  const orgId = requireOrg(run.organizationId);
  const { bookingId, template, offsetMinutes } = run.payload;
  const startsAt = new Date(run.payload.startsAt);
  if (template === "reminder" && !offsetMinutes) throw new PermanentJobError("a reminder names its offset");

  const loaded = await withSystemOrgTx(orgId, async ({ db }) => {
    const b = await db.booking.findFirst({ where: { id: bookingId, organizationId: orgId }, include: { page: true } });
    if (!b) return null;
    // Only what's still true: a cancelled booking gets only its cancellation,
    // a moved one nothing for its old time, a reminder nothing once it starts.
    const now = new Date();
    if (template === "cancelled" ? b.status !== "CANCELLED" : b.status !== "BOOKED") return null;
    if (template !== "cancelled" && b.startsAt.getTime() !== startsAt.getTime()) return null;
    if (template === "reminder") {
      if (b.startsAt <= now) return null;
      // Claim it, so a re-run or a second fan-out doesn't remind twice.
      const claimed = await db.$executeRaw`
        UPDATE "Booking" SET "remindedOffsets" = array_append(COALESCE("remindedOffsets", '{}'), ${offsetMinutes!}::int)
         WHERE "id" = ${b.id} AND "organizationId" = ${orgId} AND "status" = 'BOOKED'
           AND "startsAt" = ${startsAt.toISOString()}::timestamptz AT TIME ZONE 'UTC'
           AND NOT (${offsetMinutes!}::int = ANY (COALESCE("remindedOffsets", '{}')))`;
      if (claimed === 0) return null;
    }
    const [org, host, event] = await Promise.all([
      db.organization.findUnique({ where: { id: orgId }, select: { name: true, timezone: true } }),
      db.user.findUnique({ where: { id: b.hostUserId }, select: { name: true } }),
      db.event.findFirst({ where: { id: b.eventId, organizationId: orgId }, select: { conferenceUrl: true, conferenceProvider: true, location: true } }),
    ]);
    const tz = b.guestTimeZone ?? pageTimeZone(b.page, org?.timezone ?? "UTC");
    return { b, org, host, event, tz };
  });
  if (!loaded) return { status: "DONE" };
  const { b, org, host, event, tz } = loaded;
  const token = bookingToken(b.id);
  const message = guestEmail({
    template,
    guestName: b.guestName,
    title: b.page.title,
    hostName: host?.name ?? "your host",
    orgName: org?.name ?? "",
    when: whenText(b.startsAt, tz),
    durationMin: Math.round((b.endsAt.getTime() - b.startsAt.getTime()) / 60_000),
    verified: Boolean(b.verifiedAt),
    joinUrl: event && event.conferenceProvider !== "NONE" ? event.conferenceUrl : null,
    joinFromAccount: Boolean(event && ["MEET", "ZOOM", "TEAMS"].includes(event.conferenceProvider)),
    location: event?.location ?? null,
    linkPending: Boolean(event && event.conferenceProvider !== "NONE" && !event.conferenceUrl),
    manageUrl: appUrl(`/book/m/${token}`),
    calendarUrl: appUrl(`/book/m/${token}/calendar.ics`),
    offsetMinutes,
  });
  try {
    const routing = await resolveOrgMailRouting(orgId);
    const mailer = (routing.mode === "org" ? await getOrgMailer(orgId) : null) ?? getPlatformMailer();
    await mailer.send({ to: b.guestEmail, ...message }, { signal: run.signal });
  } catch (error) {
    if (template === "reminder") {
      // Release the claim so the retry sends it.
      await withSystemOrgTx(orgId, ({ db }) =>
        db.$executeRaw`
          UPDATE "Booking" SET "remindedOffsets" = array_remove("remindedOffsets", ${offsetMinutes!}::int)
           WHERE "id" = ${b.id} AND "organizationId" = ${orgId}`,
      );
    }
    throw error;
  }
  return { status: "DONE" };
};

export const bookingSyncJob: JobHandler<{ eventId: string }> = async (run) => {
  await syncBookingToEvent(requireOrg(run.organizationId), run.payload.eventId);
  return { status: "DONE" };
};

export const bookingHostLeftJob: JobHandler<{ userId: string }> = async (run) => {
  await bookingHostLeft(requireOrg(run.organizationId), run.payload.userId);
  return { status: "DONE" };
};
