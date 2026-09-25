import { createHash } from "node:crypto";

import { EventKind, EventVisibility } from "@/generated/prisma/enums";
import { allDaySpan, parseDateKey, safeTimeZone, zonedMidnight } from "@/lib/calendar/dates";

import type { GoogleEvent, GoogleEventBody } from "./client";

/**
 * Suite Event <-> Google Calendar event.
 *
 * Suite -> Google (the mirror):
 * - The Google id is deterministic, hex(sha256(orgId:eventId)): lowercase
 *   hex is inside Google's base32hex alphabet and 64 characters is inside
 *   its 5-1024 length, so an insert is idempotent (a retry gets 409, which
 *   the worker turns into get + patch) and a lost write can be recomputed.
 * - Timed events are dateTime + the org timezone; all-day events are
 *   date values with an exclusive end, in the org timezone.
 * - The RSVP link is the FIRST LINE of the description, the contract the
 *   club website's parseDescription relies on when it reads the calendar.
 * - extendedProperties.private carries {suiteEventId, orgId}, so the import
 *   recognizes the suite's own mirrors.
 * - Attendees are never sent. The conference link goes only on INTERNAL
 *   mirrors (the internal calendar), never on the public calendar.
 *
 * Google -> Suite (the one-time import): the website's parseDescription,
 * placeOrNull and kindOf, ported.
 */

export interface MirrorSource {
  id: string;
  organizationId: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  visibility: EventVisibility;
  rsvpUrl: string | null;
  conferenceUrl: string | null;
  publicNote: string | null;
  capacityFull: boolean;
}

/** The deterministic Google event id of a suite event. */
export function googleEventId(organizationId: string, eventId: string): string {
  return createHash("sha256").update(`${organizationId}:${eventId}`).digest("hex");
}

/** Google caps descriptions at 8 KB-ish in practice; keep well under. */
const MAX_DESCRIPTION = 8000;

function isHttpUrl(value: string | null): value is string {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export function mirrorDescription(event: MirrorSource, calendar: "public" | "internal"): string {
  const lines: string[] = [];
  if (isHttpUrl(event.rsvpUrl)) lines.push(event.rsvpUrl);
  const prose = event.description?.trim();
  if (prose) lines.push(prose);
  if (event.capacityFull) lines.push("This event is full.");
  if (event.publicNote?.trim()) lines.push(event.publicNote.trim());
  if (calendar === "internal" && isHttpUrl(event.conferenceUrl)) lines.push(`Join: ${event.conferenceUrl}`);
  return lines.join("\n").slice(0, MAX_DESCRIPTION);
}

/** The Google body for `event` on its `calendar` ("public" or "internal"). */
export function toGoogleEvent(
  event: MirrorSource,
  options: { timeZone: string; calendar: "public" | "internal" },
): GoogleEventBody {
  const timeZone = safeTimeZone(options.timeZone);
  let start: GoogleEventBody["start"];
  let end: GoogleEventBody["end"];
  if (event.allDay) {
    const span = allDaySpan(event.startsAt, event.endsAt, timeZone);
    start = { date: span.start };
    end = { date: span.endExclusive };
  } else {
    const endsAt = event.endsAt.getTime() > event.startsAt.getTime() ? event.endsAt : event.startsAt;
    start = { dateTime: event.startsAt.toISOString(), timeZone };
    end = { dateTime: endsAt.toISOString(), timeZone };
  }
  return {
    id: googleEventId(event.organizationId, event.id),
    summary: event.title,
    description: mirrorDescription(event, options.calendar),
    location: event.location?.trim() ?? "",
    start,
    end,
    status: "confirmed",
    transparency: "opaque",
    extendedProperties: { private: { suiteEventId: event.id, orgId: event.organizationId } },
  };
}

// ---- Google -> Suite (import) ------------------------------------------

const URL_RE = /https?:\/\/[^\s<>"')\]]+/;

function stripHtml(s: string): string {
  return s
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'");
}

const tidy = (s: string) =>
  s
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")
    .trim();

/** The website's parseDescription: the first link is the RSVP link, the rest is prose. */
export function parseDescription(raw: string | null | undefined): { description: string | null; rsvpUrl: string | null } {
  if (!raw) return { description: null, rsvpUrl: null };
  const text = stripHtml(raw);
  const match = text.match(URL_RE);
  if (!match || match.index === undefined) return { description: tidy(text) || null, rsvpUrl: null };
  const rsvpUrl = match[0].replace(/[.,;]+$/, "");
  const after = tidy(text.slice(match.index + match[0].length));
  if (after) return { description: after, rsvpUrl: isHttpUrl(rsvpUrl) ? rsvpUrl : null };
  const before = tidy(text.slice(0, match.index))
    .replace(/^(rsvp|register|sign\s*up)\s*[:\-–—]?\s*/i, "")
    .trim();
  return { description: before || null, rsvpUrl: isHttpUrl(rsvpUrl) ? rsvpUrl : null };
}

/** The website's placeOrNull: placeholder locations become null. */
export function placeOrNull(raw: string | null | undefined): string | null {
  const clean = (raw || "").trim();
  if (!clean) return null;
  if (/^[[(<].*[\])>]$/.test(clean)) return null;
  if (/^(tba|tbd|tbc|n\/a|na|none|no location( yet)?|unknown)$/i.test(clean)) return null;
  return clean;
}

/** The website's kindOf (title keywords), plus socials. */
export function kindOfTitle(title: string): EventKind {
  if (/athon\b|\bhack\s?night\b/i.test(title)) return EventKind.HACKATHON;
  if (
    /\binfo(rmation)?\s*(session|night)\b|\bintro\b|\borientation\b|\bkick\s?-?off\b|\binterest\s*meeting\b/i.test(
      title,
    )
  ) {
    return EventKind.INFO_SESSION;
  }
  if (/\bsocial\b|\bmixer\b|\bgame\s*night\b/i.test(title)) return EventKind.SOCIAL;
  return EventKind.WORKSHOP;
}

export interface ImportedEvent {
  googleEventId: string;
  etag: string | null;
  htmlLink: string | null;
  /** The suite event this Google event mirrors (our own extendedProperties), if any. */
  mirrorOf: { suiteEventId: string; orgId: string } | null;
  title: string;
  description: string | null;
  location: string | null;
  rsvpUrl: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  kind: EventKind;
}

/** A Google event as a suite event, or null when it cannot be one (cancelled, no start). */
export function fromGoogleEvent(g: GoogleEvent, timeZone: string): ImportedEvent | null {
  if (g.status === "cancelled" || !g.id || !g.start) return null;
  const tz = safeTimeZone(timeZone);
  const allDay = Boolean(g.start.date && !g.start.dateTime);
  let startsAt: Date;
  let endsAt: Date;
  if (allDay) {
    if (!g.start.date || !parseDateKey(g.start.date)) return null;
    startsAt = zonedMidnight(g.start.date, tz);
    const endKey = g.end?.date && parseDateKey(g.end.date) ? g.end.date : null;
    endsAt = endKey ? zonedMidnight(endKey, tz) : new Date(startsAt.getTime() + 24 * 60 * 60 * 1000);
  } else {
    startsAt = new Date(g.start.dateTime ?? "");
    endsAt = new Date(g.end?.dateTime ?? g.start.dateTime ?? "");
  }
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return null;
  if (endsAt < startsAt) endsAt = startsAt;
  const title = (g.summary ?? "").trim().slice(0, 200) || "Untitled event";
  const { description, rsvpUrl } = parseDescription(g.description);
  const priv = g.extendedProperties?.private;
  return {
    googleEventId: g.id,
    etag: g.etag ?? null,
    htmlLink: g.htmlLink ?? null,
    mirrorOf: priv?.suiteEventId && priv.orgId ? { suiteEventId: priv.suiteEventId, orgId: priv.orgId } : null,
    title,
    description: description ? description.slice(0, 20_000) : null,
    location: placeOrNull(g.location)?.slice(0, 300) ?? null,
    rsvpUrl: rsvpUrl && rsvpUrl.length <= 2000 ? rsvpUrl : null,
    startsAt,
    endsAt,
    allDay,
    kind: kindOfTitle(title),
  };
}
