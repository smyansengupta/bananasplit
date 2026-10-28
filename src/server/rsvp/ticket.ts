import { can } from "@/lib/auth/permissions";
import { safeTimeZone } from "@/lib/calendar/dates";
import { shareCents } from "@/lib/rsvp/pay";
import { withSystemOrgTx, withUserTx } from "@/server/db/context";

import { registrationCounts } from "./service";

/**
 * A guest's ticket (/e/{slug}/t/{code}): the QR in their card and emails
 * opens it. A guest sees their ticket to show at the door; a host of the
 * event (owner or admin of its club, or the person whose free page it is)
 * who scans it with any phone camera lands on the same URL and gets the
 * check-in screen instead.
 */

const CODE = /^[a-z0-9]{12}$/;

export interface TicketData {
  organizationId: string;
  eventId: string;
  registrationId: string;
  slug: string;
  name: string;
  status: "GOING" | "WAITLIST" | "CANCELLED";
  checkedInAt: Date | null;
  event: {
    title: string;
    startsAt: Date;
    endsAt: Date;
    allDay: boolean;
    location: string | null;
    timeZone: string;
    hostName: string;
    /** Where hosts run the door: the club's suite. */
    doorHref: string;
  };
  /** Split the cost: what they owe now and what's recorded. */
  cost: {
    owes: number;
    paidCents: number | null;
    claimed: boolean;
    confirmed: boolean;
  } | null;
}

export async function loadTicket(slug: string, code: string): Promise<TicketData | null> {
  if (!CODE.test(code)) return null;
  const target = await withSystemOrgTx(null, async ({ db }) => {
    const rows = await db.$queryRaw<
      { organizationId: string; eventId: string; registrationId: string; slug: string }[]
    >`SELECT "organizationId", "eventId", "registrationId", "slug" FROM app.rsvp_ticket(${code})`;
    return rows[0] ?? null;
  });
  if (!target || target.slug !== slug) return null;

  return withSystemOrgTx(target.organizationId, async ({ db }) => {
    const reg = await db.eventRegistration.findFirst({
      where: { id: target.registrationId, organizationId: target.organizationId },
      select: {
        name: true,
        status: true,
        checkedInAt: true,
        paidCents: true,
        paidClaimedAt: true,
        paidConfirmedAt: true,
        event: {
          select: {
            title: true,
            startsAt: true,
            endsAt: true,
            allDay: true,
            location: true,
            rsvpCostMode: true,
            rsvpCostCents: true,
            organization: { select: { name: true, slug: true, timezone: true } },
          },
        },
      },
    });
    if (!reg) return null;
    const e = reg.event;
    const { going } = await registrationCounts(db, target.organizationId, target.eventId);
    const owes = shareCents(e.rsvpCostMode, e.rsvpCostCents, going);
    return {
      ...target,
      name: reg.name,
      status: reg.status,
      checkedInAt: reg.checkedInAt,
      event: {
        title: e.title,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        allDay: e.allDay,
        location: e.location,
        timeZone: safeTimeZone(e.organization.timezone),
        hostName: e.organization.name,
        doorHref: `/app/${e.organization.slug}/meetings/${target.eventId}/rsvp/door`,
      },
      cost:
        owes === null
          ? null
          : {
              owes,
              paidCents: reg.paidCents,
              claimed: reg.paidClaimedAt !== null,
              confirmed: reg.paidConfirmedAt !== null,
            },
    };
  });
}

/** Whether this user runs the event's org (owner or admin; a free page's owner). */
export async function isEventHost(userId: string, organizationId: string): Promise<boolean> {
  const membership = await withUserTx(userId, ({ db }) =>
    db.membership.findFirst({
      where: { userId, organizationId, organization: { deletedAt: null } },
      select: { role: true },
    }),
  );
  return membership ? can({ role: membership.role }, "events.write") : false;
}
