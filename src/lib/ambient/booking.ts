/**
 * When the ambient buttons on Meeting links show (Meetings > Meeting links;
 * docs/features/booking.md): on a link and on a booking. Pure, so the page
 * decides and the tests pin it. Each one's condition is its reason, and it
 * goes once that stops being true. They show only where something needs
 * doing, and one takes Copy link's place on its card rather than joining it.
 */

const MINUTE_MS = 60_000;

/** Join shows this long before a booked call starts. */
export const JOIN_MINUTES = 10;

export type LinkAmbientKind = "turn-on" | "add-host";

export interface LinkAmbient {
  kind: LinkAmbientKind;
  reason: string;
}

export interface LinkFacts {
  personal: boolean;
  active: boolean;
  canEdit: boolean;
  hosts: number;
}

/** A link's button, if something needs doing: hosts first, since it can't go on without any. */
export function linkAmbient(l: LinkFacts): LinkAmbient[] {
  if (!l.canEdit) return [];
  if (!l.personal && l.hosts === 0) return [{ kind: "add-host", reason: "Nobody hosts it, so it can't take bookings" }];
  if (l.active) return [];
  return [
    {
      kind: "turn-on",
      reason: l.personal
        ? "Off until you turn it on, so nobody sees your free times yet"
        : "It's off, so nobody can book it",
    },
  ];
}

export type BookingAmbientKind = "take" | "join";

export interface BookingAmbient {
  kind: BookingAmbientKind;
  reason: string;
}

export interface BookingFacts {
  startsAt: Date;
  endsAt: Date;
  joinUrl: string | null;
  needsHost: boolean;
  /** An owner or admin. */
  canTake: boolean;
}

/** A booking's buttons: Take it when its host left, Join in the last ten minutes. */
export function bookingAmbient(b: BookingFacts, now: Date): BookingAmbient[] {
  const out: BookingAmbient[] = [];
  if (b.needsHost && b.canTake) out.push({ kind: "take", reason: "Its host left the organization" });
  const t = now.getTime();
  const near = t >= b.startsAt.getTime() - JOIN_MINUTES * MINUTE_MS && t < b.endsAt.getTime();
  if (b.joinUrl && near) {
    const mins = Math.ceil((b.startsAt.getTime() - t) / MINUTE_MS);
    out.push({
      kind: "join",
      reason: mins > 0 ? `Starts in ${mins === 1 ? "a minute" : `${mins} minutes`}` : "It's started",
    });
  }
  return out;
}

/** Why a booking says it's unconfirmed: the guest hasn't said the address is theirs. */
export function confirmWaiting(guestName: string): string {
  const first = guestName.trim().split(/\s+/)[0] || "They";
  return `${first} hasn't confirmed their email yet. It's on the calendar either way.`;
}
