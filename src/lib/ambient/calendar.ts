/**
 * When an event's ambient buttons show (Buttons2: Calendar, events, RSVP and
 * polls). Plain functions of the event and now, so the meeting page, the
 * RSVP page, the week view and the polls agree. The UI maps each kind to its
 * button and shows the first two.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Sign-ups are "few" under this when there's no capacity to compare with. */
export const FEW_SIGNUPS = 10;
/** After it ends, the thank-you and attendance stay offered this long. */
const AFTER_DAYS = 3;
/** A poll closing within this long offers to close now. */
const CLOSING_SOON_MS = DAY_MS;

export type EventAmbientKind =
  | "door"
  | "open-waitlist"
  | "add-seats"
  | "share-rsvp"
  | "remind-members"
  | "thank-you"
  | "log-attendance";

export interface EventAmbient {
  kind: EventAmbientKind;
  reason: string;
}

export interface EventAmbientInput {
  startsAt: Date;
  endsAt: Date;
  /** The organization's zone: what "event day" means. */
  timeZone: string;
  canEdit: boolean;
  rsvp: {
    enabled: boolean;
    url: string | null;
    going: number;
    waitlist: number;
    capacity: number | null;
    /** Once full, new sign-ups join a waitlist. */
    waitlistOn: boolean;
  };
  /** Guests checked in at the door, plus the session's attendance. */
  checkedIn: number;
  /** A thank-you already went out for it. */
  thankedAt: Date | null;
}

function dayKey(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function people(n: number): string {
  return n === 1 ? "1 person" : `${n} people`;
}

/** Fewer than half the spots, or under ten with no limit. */
export function fewSignups(going: number, capacity: number | null): boolean {
  return capacity ? going < Math.ceil(capacity / 2) : going < FEW_SIGNUPS;
}

/** What an event's ambient buttons are right now, most useful first. */
export function eventAmbient(e: EventAmbientInput, now: Date): EventAmbient[] {
  if (!e.canEdit) return [];
  const out: EventAmbient[] = [];
  const t = now.getTime();
  const start = e.startsAt.getTime();
  const end = e.endsAt.getTime();
  const { rsvp } = e;

  if (rsvp.enabled && t < end && dayKey(e.startsAt, e.timeZone) === dayKey(now, e.timeZone)) {
    out.push({ kind: "door", reason: "It's event day" });
  }

  if (rsvp.enabled && t < end && rsvp.capacity && rsvp.going >= rsvp.capacity) {
    const full = `${rsvp.going} of ${rsvp.capacity} spots taken`;
    if (!rsvp.waitlistOn) {
      out.push({ kind: "open-waitlist", reason: `${full}, sign-ups are closed` });
    }
    out.push({
      kind: "add-seats",
      reason: rsvp.waitlist > 0 ? `${full}, ${rsvp.waitlist} waiting` : full,
    });
  } else if (
    rsvp.enabled &&
    start > t &&
    start - t <= 2 * DAY_MS &&
    fewSignups(rsvp.going, rsvp.capacity)
  ) {
    const reason = `Starts in ${start - t <= DAY_MS ? "a day" : "2 days"}, ${rsvp.going} signed up`;
    if (rsvp.url) out.push({ kind: "share-rsvp", reason });
    out.push({ kind: "remind-members", reason });
  }

  if (t >= end && t - end <= AFTER_DAYS * DAY_MS && rsvp.enabled && rsvp.going > 0) {
    if (!e.thankedAt) {
      out.push({ kind: "thank-you", reason: `It's over, ${people(rsvp.going)} signed up` });
    }
    if (e.checkedIn === 0) out.push({ kind: "log-attendance", reason: "Nobody is checked in yet" });
  }

  return out;
}

/** The event didn't reach Google Calendar: Retry sync. */
export function needsSyncRetry(e: { googleSyncState: string; canEdit: boolean }): boolean {
  return e.canEdit && e.googleSyncState === "FAILED";
}

export interface ClashEvent {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
}

/**
 * The first two timed events that overlap (all-day ones sit beside the day,
 * not in it). `move` is the later one, or the shorter when they start
 * together: the one it's easier to move.
 */
export function firstClash<T extends ClashEvent>(
  events: readonly T[],
): { keep: T; move: T } | null {
  const timed = events
    .filter((e) => !e.allDay && e.endsAt > e.startsAt)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id));
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i]!;
      const b = timed[j]!;
      if (b.startsAt >= a.endsAt) break;
      const later =
        b.startsAt > a.startsAt
          ? b
          : b.endsAt.getTime() - b.startsAt.getTime() <= a.endsAt.getTime() - a.startsAt.getTime()
            ? b
            : a;
      return { keep: later === a ? b : a, move: later };
    }
  }
  return null;
}

export interface FindTimeSlot {
  id: string;
  startsAt: Date;
}

export interface FindTimeAnswer {
  slotId: string;
  /** A member's id, or a guest's key. */
  who: string;
  availability: "YES" | "NO" | "IF_NEEDED";
}

/**
 * The time that works for everyone who has answered (yes or if needed), for
 * Pick it: the one with the most plain yeses, then the earliest. Null with
 * fewer than two people, or when no time suits them all.
 */
export function timeForEveryone(
  slots: readonly FindTimeSlot[],
  answers: readonly FindTimeAnswer[],
): { slot: FindTimeSlot; people: number } | null {
  const everyone = new Set(answers.map((a) => a.who));
  if (everyone.size < 2) return null;
  let best: { slot: FindTimeSlot; yes: number } | null = null;
  for (const slot of [...slots].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())) {
    const here = answers.filter((a) => a.slotId === slot.id && a.availability !== "NO");
    const can = new Set(here.map((a) => a.who));
    if (can.size !== everyone.size) continue;
    const yes = new Set(here.filter((a) => a.availability === "YES").map((a) => a.who)).size;
    if (!best || yes > best.yes) best = { slot, yes };
  }
  return best ? { slot: best.slot, people: everyone.size } : null;
}

/** A question poll closing within a day: Close now and post results. */
export function pollClosingSoon(
  poll: { isOpen: boolean; canManage: boolean; closesAt: Date | null },
  now: Date,
): boolean {
  if (!poll.isOpen || !poll.canManage || !poll.closesAt) return false;
  const left = poll.closesAt.getTime() - now.getTime();
  return left > 0 && left <= CLOSING_SOON_MS;
}
