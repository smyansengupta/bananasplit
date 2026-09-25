import { EventKind } from "@/generated/prisma/enums";
import { allDaySpan, safeTimeZone } from "@/lib/calendar/dates";
import { eventUid, type IcsEvent } from "@/lib/ics";

/**
 * The public events feed's payloads (/api/public/[orgSlug]/events and
 * .ics). Pure functions over the rows the cached loader returns, so the
 * same rows always produce the same bytes (the ETag depends on it).
 *
 * Field allowlist: only what the club website shows. No ids of people, no
 * host, no conference link, no internal notes, no sync state.
 */

/** One public event as the cached loader stores it (JSON-safe: ISO strings). */
export interface PublicEventRow {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  kind: EventKind;
  rsvpUrl: string | null;
  capacityFull: boolean;
  featured: boolean;
  publicNote: string | null;
  syncVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface PublicEventsFeed {
  orgName: string;
  timeZone: string;
  events: PublicEventRow[];
}

/**
 * The website's ClubEvent (claudeneu.com src/lib/events.js), field for field,
 * plus the explicit kind, full, featured and note the website otherwise
 * derives from titles. Key order is fixed (it is part of the bytes).
 */
export interface ClubEvent {
  id: string;
  title: string;
  /** ISO instant; all-day: the org-timezone date as `YYYY-MM-DDT00:00:00.000Z`. */
  start: string;
  /** ISO instant; all-day: the day after the last day (exclusive), same form. */
  end: string | null;
  location: string | null;
  description: string | null;
  rsvpUrl: string | null;
  url: string | null;
  allDay: boolean;
  /** The website's kinds; null lets the website infer it from the title. */
  kind: WebsiteKind | null;
  full: boolean;
  featured: boolean;
  note: string | null;
}

export type WebsiteKind = "info" | "workshop" | "hackathon" | "social";

const WEBSITE_KIND: Record<EventKind, WebsiteKind | null> = {
  [EventKind.INFO_SESSION]: "info",
  [EventKind.WORKSHOP]: "workshop",
  [EventKind.HACKATHON]: "hackathon",
  [EventKind.SOCIAL]: "social",
  [EventKind.BOARD_MEETING]: null,
  [EventKind.OTHER]: null,
};

export function websiteKind(kind: EventKind): WebsiteKind | null {
  return WEBSITE_KIND[kind] ?? null;
}

function httpUrlOrNull(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Deterministic order: start time, then id (plain code-unit order, no collation). */
export function sortPublicEvents<T extends { startsAt: string; id: string }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => {
    const d = Date.parse(a.startsAt) - Date.parse(b.startsAt);
    if (d !== 0) return d;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export interface ShapeOptions {
  timeZone: string;
  /** The UID host (the public feed and the ICS share ids). */
  uidHost?: string;
}

export function toClubEvent(row: PublicEventRow, options: ShapeOptions): ClubEvent {
  const timeZone = safeTimeZone(options.timeZone);
  const startsAt = new Date(row.startsAt);
  const endsAt = new Date(row.endsAt);
  let start: string;
  let end: string | null;
  if (row.allDay) {
    const span = allDaySpan(startsAt, endsAt, timeZone);
    start = `${span.start}T00:00:00.000Z`;
    end = `${span.endExclusive}T00:00:00.000Z`;
  } else {
    start = startsAt.toISOString();
    end = endsAt.getTime() > startsAt.getTime() ? endsAt.toISOString() : null;
  }
  const rsvpUrl = httpUrlOrNull(row.rsvpUrl);
  return {
    id: eventUid(row.id, options.uidHost),
    title: row.title,
    start,
    end,
    location: row.location?.trim() || null,
    description: row.description?.trim() || null,
    rsvpUrl,
    url: rsvpUrl,
    allDay: row.allDay,
    kind: websiteKind(row.kind),
    full: row.capacityFull,
    featured: row.featured,
    note: row.publicNote?.trim() || null,
  };
}

/** The JSON body: a compact array in feed order. */
export function publicEventsJson(
  feed: PublicEventsFeed,
  options: Omit<ShapeOptions, "timeZone"> = {},
): string {
  const events = sortPublicEvents(feed.events).map((row) =>
    toClubEvent(row, { timeZone: feed.timeZone, uidHost: options.uidHost }),
  );
  return JSON.stringify(events);
}

/**
 * The ICS entries. The RSVP link leads the description (the website's
 * parseDescription contract for calendar entries) and is the URL property.
 */
export function publicIcsEvents(feed: PublicEventsFeed): IcsEvent[] {
  return sortPublicEvents(feed.events).map((row) => {
    const rsvpUrl = httpUrlOrNull(row.rsvpUrl);
    const prose = [row.description?.trim(), row.publicNote?.trim()].filter(Boolean).join("\n\n");
    return {
      id: row.id,
      title: row.title,
      description: [rsvpUrl, prose].filter(Boolean).join("\n") || null,
      location: row.location?.trim() || null,
      startsAt: new Date(row.startsAt),
      endsAt: new Date(row.endsAt),
      allDay: row.allDay,
      updatedAt: new Date(row.updatedAt),
      createdAt: new Date(row.createdAt),
      sequence: row.syncVersion,
      status: "CONFIRMED",
      url: rsvpUrl,
    };
  });
}
