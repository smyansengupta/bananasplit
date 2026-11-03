import { AttendanceMethod, RecordSource } from "@/generated/prisma/client";
import type { TxClient } from "@/server/db/context";
import { findOrCreateContact, newId } from "@/server/databases/admin";
import { termOf } from "@/server/databases/format";
import { queueCrmRefreshFor } from "@/server/crm/schedule";
import { afterDataChange } from "@/server/databases/rollups";

/**
 * Checking a guest in at the door (the guest list, door mode, or a host
 * scanning their ticket). In a club, a check-in also lands in the club's
 * People and Attendance databases: the guest becomes a contact (matched by
 * email), the event gets their attendance row, and their history across
 * events builds up. That is what a club keeps that a free page doesn't.
 *
 * The attendance part is best effort, inside a savepoint: if the club's
 * databases refuse it (a read-only Attendance database, or an admin who
 * can't see contact emails), the check-in itself still stands.
 */

export interface CheckInResult {
  ok: boolean;
  /** The guest's name, for "Maya Patel is in". */
  name?: string;
  /** They were already checked in (a second scan). */
  already?: boolean;
  /** A check-in that also made (or found) the club's attendance row. */
  attendance?: boolean;
}

export async function setRegistrationCheckIn(
  db: TxClient,
  input: {
    organizationId: string;
    eventId: string;
    registrationId: string;
    checkedIn: boolean;
    actorUserId: string;
    method: "QR" | "MANUAL";
    now?: Date;
  },
): Promise<CheckInResult> {
  const now = input.now ?? new Date();
  const reg = await db.eventRegistration.findFirst({
    where: {
      id: input.registrationId,
      organizationId: input.organizationId,
      eventId: input.eventId,
    },
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      checkedInAt: true,
      attendanceId: true,
      event: {
        select: {
          startsAt: true,
          term: true,
          organization: { select: { timezone: true } },
        },
      },
    },
  });
  if (!reg || reg.status === "CANCELLED") return { ok: false };

  if (input.checkedIn && reg.checkedInAt) {
    return { ok: true, name: reg.name, already: true, attendance: Boolean(reg.attendanceId) };
  }
  if (!input.checkedIn && !reg.checkedInAt) return { ok: true, name: reg.name };

  await db.eventRegistration.update({
    where: { id: reg.id },
    data: { checkedInAt: input.checkedIn ? now : null },
  });

  let attendance = false;
  await db.$executeRaw`SAVEPOINT rsvp_attendance`;
  try {
    if (input.checkedIn) {
      const contact = await findOrCreateContact(db, input.organizationId, {
        email: reg.email,
        name: reg.name,
        at: now,
      });
      const existing = await db.attendance.findFirst({
        where: {
          organizationId: input.organizationId,
          eventId: input.eventId,
          contactId: contact.id,
        },
        select: { id: true },
      });
      // A check-in the club already had (the website, a manual entry) stays
      // theirs: only a row made here is linked, so only it is undone here.
      const attendanceId = existing
        ? null
        : (
            await db.attendance.create({
              data: {
                id: newId("att_"),
                organizationId: input.organizationId,
                eventId: input.eventId,
                contactId: contact.id,
                term: reg.event.term ?? termOf(now, reg.event.organization.timezone),
                checkedInAt: now,
                method: input.method === "QR" ? AttendanceMethod.QR : AttendanceMethod.MANUAL,
                nameAsEntered: reg.name,
                source: RecordSource.SUITE,
                createdById: input.actorUserId,
              },
              select: { id: true },
            })
          ).id;
      if (attendanceId) {
        await db.eventRegistration.update({ where: { id: reg.id }, data: { attendanceId } });
      }
      await afterDataChange(db, input.organizationId, [contact.id]);
      attendance = true;
    } else if (reg.attendanceId) {
      // Undoing a check-in removes the attendance row it made, nothing else.
      const row = await db.attendance.findFirst({
        where: { id: reg.attendanceId, organizationId: input.organizationId },
        select: { id: true, contactId: true, source: true },
      });
      await db.eventRegistration.update({ where: { id: reg.id }, data: { attendanceId: null } });
      if (row && row.source === RecordSource.SUITE) {
        await db.attendance.delete({ where: { id: row.id } });
        await afterDataChange(db, input.organizationId, [row.contactId]);
      }
    }
    await db.$executeRaw`RELEASE SAVEPOINT rsvp_attendance`;
  } catch (error) {
    await db.$executeRaw`ROLLBACK TO SAVEPOINT rsvp_attendance`;
    console.warn(
      "[rsvp] check-in saved without the organization's attendance row",
      error instanceof Error ? error.message : error,
    );
    attendance = false;
  }
  // The CRM's timeline for whoever this is, now rather than at the nightly run.
  if (input.checkedIn) await queueCrmRefreshFor(db, input.organizationId, { kind: "registration", id: reg.id });
  return { ok: true, name: reg.name, attendance };
}
