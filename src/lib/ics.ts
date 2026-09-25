import { appOrigin } from "@/lib/app-url";
import { allDaySpan, safeTimeZone } from "@/lib/calendar/dates";

/**
 * iCalendar (RFC 5545) output for the per-user feed, the one-event download
 * and the public /api/public/[orgSlug]/events.ics feed.
 *
 * - UIDs are stable: `{eventId}@{host of NEXT_PUBLIC_APP_URL}`, so a
 *   subscriber's calendar updates an event in place instead of duplicating it.
 * - SEQUENCE is the event's syncVersion (bumped on every save), STATUS and
 *   LAST-MODIFIED come from the row, URL is the RSVP link.
 * - All-day events are DATE values in the org timezone with an EXCLUSIVE
 *   DTEND (the day after the last day); timed events are UTC.
 * - Lines are folded at 75 octets without splitting a UTF-8 character.
 * - Output is deterministic: DTSTAMP is the row's updatedAt, not "now", so
 *   the same data always produces the same bytes (the public feed's ETag).
 */

export interface IcsEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  updatedAt: Date;
  /** SEQUENCE; the event's syncVersion. */
  sequence?: number;
  status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  /** URL property (the RSVP link). http(s) only; anything else is dropped. */
  url?: string | null;
  createdAt?: Date | null;
  /** The event's org timezone, when a feed mixes orgs (defaults to the calendar's). */
  timeZone?: string;
}

export interface IcsCalendarOptions {
  /** X-WR-CALNAME. */
  name?: string;
  /** X-WR-CALDESC. */
  description?: string;
  /** IANA zone for all-day dates and X-WR-TIMEZONE (default UTC). */
  timeZone?: string;
  /** The UID host (default: the host of NEXT_PUBLIC_APP_URL). */
  uidHost?: string;
  /** REFRESH-INTERVAL / X-PUBLISHED-TTL hint for subscribers, in minutes. */
  refreshMinutes?: number;
}

const CRLF = "\r\n";

function formatUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function compactDate(key: string): string {
  return key.replace(/-/g, "");
}

/** Escapes a TEXT value (RFC 5545 3.3.11): backslash, semicolon, comma, newlines. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

function utf8Length(codePoint: string): number {
  const cp = codePoint.codePointAt(0) ?? 0;
  if (cp < 0x80) return 1;
  if (cp < 0x800) return 2;
  if (cp < 0x10000) return 3;
  return 4;
}

/**
 * Folds a content line at 75 octets (RFC 5545 3.1). Continuation lines start
 * with one space, which counts toward their 75. Never splits a multibyte
 * UTF-8 sequence.
 */
export function foldLine(line: string): string {
  const chunks: string[] = [];
  let current = "";
  let octets = 0;
  let limit = 75;
  for (const ch of line) {
    const size = utf8Length(ch);
    if (octets + size > limit) {
      chunks.push(current);
      current = "";
      octets = 0;
      limit = 74; // the leading space of the continuation line
    }
    current += ch;
    octets += size;
  }
  chunks.push(current);
  return chunks.join(`${CRLF} `);
}

function safeUri(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.href.replace(/[\r\n]/g, "");
  } catch {
    return null;
  }
}

/** The host part of the UID: the app's host, never a request's Host header. */
export function defaultUidHost(): string {
  try {
    return new URL(appOrigin()).host || "cbc-portal";
  } catch {
    return "cbc-portal";
  }
}

/** The stable UID of an event. */
export function eventUid(eventId: string, uidHost: string = defaultUidHost()): string {
  return `${eventId}@${uidHost}`;
}

function buildVEvent(event: IcsEvent, timeZone: string, uidHost: string): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${eventUid(event.id, uidHost)}`,
    `DTSTAMP:${formatUtc(event.updatedAt)}`,
  ];
  if (event.allDay) {
    const span = allDaySpan(
      event.startsAt,
      event.endsAt,
      event.timeZone ? safeTimeZone(event.timeZone) : timeZone,
    );
    lines.push(`DTSTART;VALUE=DATE:${compactDate(span.start)}`);
    lines.push(`DTEND;VALUE=DATE:${compactDate(span.endExclusive)}`);
  } else {
    lines.push(`DTSTART:${formatUtc(event.startsAt)}`);
    const end = event.endsAt.getTime() > event.startsAt.getTime() ? event.endsAt : event.startsAt;
    lines.push(`DTEND:${formatUtc(end)}`);
  }
  lines.push(`SEQUENCE:${Math.max(0, Math.trunc(event.sequence ?? 0))}`);
  lines.push(`STATUS:${event.status ?? "CONFIRMED"}`);
  lines.push(`SUMMARY:${escapeText(event.title)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  const url = safeUri(event.url);
  if (url) lines.push(`URL:${url}`);
  if (event.createdAt) lines.push(`CREATED:${formatUtc(event.createdAt)}`);
  lines.push(`LAST-MODIFIED:${formatUtc(event.updatedAt)}`);
  lines.push("END:VEVENT");
  return lines;
}

/**
 * A VCALENDAR with `events`. The second argument is the calendar name (the
 * original signature) or the full options.
 */
export function buildIcsCalendar(
  events: IcsEvent[],
  nameOrOptions: string | IcsCalendarOptions = "CBC Portal",
): string {
  const options: IcsCalendarOptions =
    typeof nameOrOptions === "string" ? { name: nameOrOptions } : nameOrOptions;
  const timeZone = safeTimeZone(options.timeZone);
  const uidHost = options.uidHost ?? defaultUidHost();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CBC Portal//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(options.name ?? "CBC Portal")}`,
  ];
  if (options.description) lines.push(`X-WR-CALDESC:${escapeText(options.description)}`);
  if (options.timeZone) lines.push(`X-WR-TIMEZONE:${timeZone}`);
  if (options.refreshMinutes && options.refreshMinutes > 0) {
    const minutes = Math.trunc(options.refreshMinutes);
    lines.push(`REFRESH-INTERVAL;VALUE=DURATION:PT${minutes}M`);
    lines.push(`X-PUBLISHED-TTL:PT${minutes}M`);
  }
  for (const event of events) lines.push(...buildVEvent(event, timeZone, uidHost));
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join(CRLF) + CRLF;
}
