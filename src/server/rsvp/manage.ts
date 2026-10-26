import { appUrl } from "@/lib/app-url";
import { safeTimeZone } from "@/lib/calendar/dates";
import { rsvpCover } from "@/lib/rsvp/cover";
import { shareCents } from "@/lib/rsvp/pay";
import { parsePayTo } from "@/lib/rsvp/pay-schema";
import { whenLine } from "@/lib/rsvp/when";
import type { DoorGuest } from "@/components/rsvp/door-mode";
import type { RsvpManagerProps } from "@/components/rsvp/rsvp-manager";
import type { TxClient } from "@/server/db/context";

/**
 * What the host's RSVP screen needs (the suite's /meetings/{id}/rsvp), read
 * in the host's own transaction: RLS lets only
 * owners and admins see sign-ups. Null when the event is gone.
 */
export async function loadRsvpManager(
  db: TxClient,
  organizationId: string,
  eventId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<{
  event: {
    id: string;
    title: string;
    startsAt: Date;
    endsAt: Date;
    rsvpSlug: string | null;
  };
  props: Omit<RsvpManagerProps, "links" | "messaging" | "initialTab">;
} | null> {
  const event = await db.event.findFirst({
    where: { id: eventId, organizationId, deletedAt: null },
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      allDay: true,
      location: true,
      rsvpEnabled: true,
      rsvpSlug: true,
      locationDetails: true,
      rsvpCapacity: true,
      rsvpWaitlist: true,
      rsvpClosed: true,
      rsvpHideLocation: true,
      rsvpHideGuests: true,
      rsvpHideCount: true,
      rsvpBackground: true,
      rsvpCover: true,
      rsvpCostMode: true,
      rsvpCostCents: true,
      rsvpCostNote: true,
      rsvpPayTo: true,
    },
  });
  if (!event) return null;

  const guests = await db.eventRegistration.findMany({
    where: { organizationId, eventId: event.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      instagram: true,
      status: true,
      checkedInAt: true,
      createdAt: true,
      invitedById: true,
      paidCents: true,
      paidClaimedAt: true,
      paidConfirmedAt: true,
      itemClaims: { select: { item: { select: { label: true } } } },
    },
  });
  const items = await db.rsvpItem.findMany({
    where: { organizationId, eventId: event.id },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, label: true, slots: true, _count: { select: { claims: true } } },
  });

  const byId = new Map(guests.map((g) => [g.id, g]));
  const brought = new Map<string, number>();
  for (const g of guests) {
    if (g.invitedById && g.status !== "CANCELLED") {
      brought.set(g.invitedById, (brought.get(g.invitedById) ?? 0) + 1);
    }
  }
  const going = guests.filter((g) => g.status === "GOING").length;
  const payTo = parsePayTo(event.rsvpPayTo);
  const dollars = (cents: number | null) =>
    cents === null ? "" : (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);

  return {
    event,
    props: {
      orgId: organizationId,
      event: {
        id: event.id,
        title: event.title,
        when: whenLine(event.startsAt, event.endsAt, safeTimeZone(timezone), event.allDay),
        location: event.location,
        ended: event.endsAt <= now,
      },
      page: {
        enabled: event.rsvpEnabled,
        url: event.rsvpSlug ? appUrl(`/e/${event.rsvpSlug}`) : null,
        cover: rsvpCover(event.rsvpCover),
        settings: {
          locationDetails: event.locationDetails ?? "",
          capacity: event.rsvpCapacity,
          waitlist: event.rsvpWaitlist,
          closed: event.rsvpClosed,
          hideLocation: event.rsvpHideLocation,
          hideGuests: event.rsvpHideGuests,
          hideCount: event.rsvpHideCount,
          background: event.rsvpBackground,
          costMode: event.rsvpCostMode,
          costText: dollars(event.rsvpCostCents),
          costNote: event.rsvpCostNote ?? "",
          payTo: {
            venmo: payTo.venmo ?? "",
            cashapp: payTo.cashapp ?? "",
            paypal: payTo.paypal ?? "",
            zelle: payTo.zelle ?? "",
          },
        },
      },
      guests: guests.map((g) => ({
        id: g.id,
        name: g.name,
        email: g.email,
        phone: g.phone,
        instagram: g.instagram,
        status: g.status,
        checkedIn: g.checkedInAt !== null,
        createdAt: g.createdAt.toISOString(),
        invitedBy: g.invitedById ? (byId.get(g.invitedById)?.name ?? null) : null,
        invitedCount: brought.get(g.id) ?? 0,
        bringing: g.itemClaims.map((c) => c.item.label),
        paid: {
          cents: g.paidCents,
          claimed: g.paidClaimedAt !== null,
          confirmed: g.paidConfirmedAt !== null,
        },
      })),
      items: items.map((i) => ({
        id: i.id,
        label: i.label,
        slots: i.slots,
        taken: i._count.claims,
      })),
      owes: shareCents(event.rsvpCostMode, event.rsvpCostCents, going),
    },
  };
}

/** Door mode: everyone going or waitlisted, with their ticket codes (hosts only, RLS). */
export async function loadDoorList(
  db: TxClient,
  organizationId: string,
  eventId: string,
  timezone: string,
): Promise<{
  title: string;
  when: string;
  guests: DoorGuest[];
} | null> {
  const event = await db.event.findFirst({
    where: { id: eventId, organizationId, deletedAt: null },
    select: {
      title: true,
      startsAt: true,
      endsAt: true,
      allDay: true,
      rsvpCostMode: true,
      rsvpCostCents: true,
    },
  });
  if (!event) return null;
  const rows = await db.eventRegistration.findMany({
    where: { organizationId, eventId, status: { in: ["GOING", "WAITLIST"] } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      status: true,
      checkedInAt: true,
      ticketCode: true,
      paidClaimedAt: true,
      paidConfirmedAt: true,
    },
  });
  const going = rows.filter((r) => r.status === "GOING").length;
  const share = shareCents(event.rsvpCostMode, event.rsvpCostCents, going);
  return {
    title: event.title,
    when: whenLine(event.startsAt, event.endsAt, safeTimeZone(timezone), event.allDay),
    guests: rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status as "GOING" | "WAITLIST",
      checkedIn: r.checkedInAt !== null,
      ticketCode: r.ticketCode,
      owes: share !== null && !r.paidConfirmedAt ? share : null,
      saysPaid: r.paidClaimedAt !== null && !r.paidConfirmedAt,
    })),
  };
}
