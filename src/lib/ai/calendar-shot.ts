import { z } from "zod";

import { isValidTimeZone } from "@/lib/calendar/dates";
import { isDateKey } from "@/lib/tasks/dates";

import { addMinutesLocal } from "./action-items";

/**
 * A screenshot of a calendar item (an invite, a calendar app entry, an
 * email, a flyer) into calendar events. A model reads the image and answers
 * in CalendarShotOutput; normalizeShotEvents() turns that into rows a
 * person reviews before anything is created. The image is never stored.
 * Pure and client-safe.
 */

export const SHOT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type ShotImageType = (typeof SHOT_IMAGE_TYPES)[number];
export const MAX_SHOT_EVENTS = 20;

export const CalendarShotOutput = z.object({
  events: z.array(
    z.object({
      title: z.string(),
      date: z.string(),
      startTime: z.string().nullable(),
      endDate: z.string().nullable(),
      endTime: z.string().nullable(),
      timezone: z.string().nullable(),
      location: z.string().nullable(),
      description: z.string().nullable(),
      meetingUrl: z.string().nullable(),
      recurrence: z.string().nullable(),
    }),
  ),
  notes: z.array(z.string()),
});
export type CalendarShotOutputData = z.infer<typeof CalendarShotOutput>;

export type ShotConference = "NONE" | "MEET" | "ZOOM" | "TEAMS" | "OTHER";

export interface ProposedEvent {
  key: string;
  title: string;
  allDay: boolean;
  /** YYYY-MM-DD */
  date: string;
  /** YYYY-MM-DD: the last day of an all-day event, or the day a timed one ends. */
  endDate: string;
  /** HH:MM, empty for all-day. */
  startTime: string;
  endTime: string;
  /** The zone the times are in: the one the image shows, or the club's. */
  timezone: string;
  location: string | null;
  description: string | null;
  conferenceProvider: ShotConference;
  conferenceUrl: string | null;
  /** "Every Thursday" when the image shows a repeat (one event is made; repeats are noted). */
  recurrence: string | null;
}

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function text(value: string | null | undefined, max: number, oneLine = false): string | null {
  let t = (value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  if (oneLine) t = t.replace(/\s+/g, " ");
  t = t.trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function hhmm(value: string | null | undefined): string | null {
  const m = value ? HHMM.exec(value.trim()) : null;
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

/** A video link the calendar can show as such, or null (unknown links go in the description). */
export function conferenceOf(url: string | null | undefined): { provider: ShotConference; url: string } | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  const host = parsed.hostname.toLowerCase();
  const clean = parsed.toString().slice(0, 2_000);
  if (host === "meet.google.com") return { provider: "MEET", url: clean };
  if (host === "zoom.us" || host.endsWith(".zoom.us")) return { provider: "ZOOM", url: clean };
  if (host === "teams.microsoft.com") return { provider: "TEAMS", url: clean };
  return null;
}

/** The model's events as review rows: dates and times checked, zone validated, lengths capped. */
export function normalizeShotEvents(
  raw: CalendarShotOutputData,
  clubTimezone: string,
): { events: ProposedEvent[]; notes: string[] } {
  const events: ProposedEvent[] = [];
  for (const e of raw.events) {
    if (events.length >= MAX_SHOT_EVENTS) break;
    const title = text(e.title, 200, true);
    const date = e.date?.trim();
    if (!title || !date || !isDateKey(date)) continue;
    const startTime = hhmm(e.startTime);
    const allDay = startTime === null;
    let endDate = e.endDate && isDateKey(e.endDate.trim()) && e.endDate.trim() >= date ? e.endDate.trim() : date;
    let endTime = "";
    if (!allDay) {
      const end = hhmm(e.endTime);
      let endLocal = end ? `${endDate}T${end}` : "";
      const startLocal = `${date}T${startTime}`;
      if (!endLocal || endLocal <= startLocal) endLocal = addMinutesLocal(startLocal, 60);
      endDate = endLocal.slice(0, 10);
      endTime = endLocal.slice(11, 16);
    }
    const zone = e.timezone?.trim();
    const conference = conferenceOf(e.meetingUrl);
    let description = text(e.description, 2_000);
    if (e.meetingUrl && !conference) {
      const link = text(e.meetingUrl, 500, true);
      if (link && !(description ?? "").includes(link)) description = description ? `${description}\n\n${link}` : link;
    }
    events.push({
      key: `e${events.length + 1}`,
      title,
      allDay,
      date,
      endDate,
      startTime: startTime ?? "",
      endTime,
      timezone: zone && isValidTimeZone(zone) ? zone : clubTimezone,
      location: text(e.location, 300, true),
      description,
      conferenceProvider: conference?.provider ?? "NONE",
      conferenceUrl: conference?.url ?? null,
      recurrence: text(e.recurrence, 120, true),
    });
  }
  const notes = raw.notes.map((n) => text(n, 300, true)).filter((n): n is string => Boolean(n)).slice(0, 10);
  return { events, notes };
}
