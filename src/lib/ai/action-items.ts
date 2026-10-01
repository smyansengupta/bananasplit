import { z } from "zod";

import { isDateKey } from "@/lib/tasks/dates";

/**
 * Action items into tasks and events (the AI import on Tasks and in Notes).
 * A model reads a pasted list or a note and answers in ActionItemsOutput;
 * normalizeActionItems() turns that into rows a person reviews and edits
 * before anything is created. Pure and client-safe: the review dialog uses
 * the same types.
 *
 * The model never sees user ids or emails: members are listed under opaque
 * keys (m1, m2…) with their name and title, and only keys come back. Any
 * key the server did not hand out is dropped here.
 */

export const MAX_ACTION_TEXT = 20_000;
export const MAX_ACTION_ITEMS = 100;

const PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export type ImportPriority = (typeof PRIORITIES)[number];

/** What the model must answer: every field present, null when unknown. */
export const ActionItemsOutput = z.object({
  items: z.array(
    z.object({
      kind: z.enum(["task", "event"]),
      title: z.string(),
      description: z.string().nullable(),
      owner: z.string().nullable(),
      helpers: z.array(z.string()),
      dueDate: z.string().nullable(),
      priority: z.enum(PRIORITIES),
      startsAt: z.string().nullable(),
      endsAt: z.string().nullable(),
      allDay: z.boolean(),
      location: z.string().nullable(),
      sourceText: z.string(),
    }),
  ),
  notes: z.array(z.string()),
});
export type ActionItemsOutputData = z.infer<typeof ActionItemsOutput>;

/** One row of the review: a task, or an event when the text names a time. */
export interface ProposedItem {
  key: string;
  kind: "task" | "event";
  title: string;
  description: string | null;
  ownerId: string | null;
  helperIds: string[];
  /** YYYY-MM-DD (tasks; an event's day). */
  dueDate: string | null;
  priority: ImportPriority;
  /** Events: YYYY-MM-DDTHH:MM in the club's timezone. */
  startsAt: string | null;
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
  /** The line(s) it came from, to check the reading against. */
  sourceText: string;
}

export interface ImportMember {
  /** The opaque key the model sees ("m1"). */
  key: string;
  userId: string;
  name: string;
  title: string | null;
}

const LOCAL_DATETIME = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

function clean(value: string | null | undefined, max: number): string | null {
  const text = (value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function oneLine(value: string | null | undefined, max: number): string | null {
  return clean((value ?? "").replace(/\s+/g, " "), max);
}

/** "YYYY-MM-DDTHH:MM" plus minutes, as wall-clock arithmetic (no timezone involved). */
export function addMinutesLocal(local: string, minutes: number): string {
  const m = LOCAL_DATETIME.exec(local);
  if (!m) return local;
  const [y, mo, d] = m[1].split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, Number(m[2]), Number(m[3])) + minutes * 60_000);
  return t.toISOString().slice(0, 16);
}

export function isLocalDateTime(value: string | null | undefined): value is string {
  const m = value ? LOCAL_DATETIME.exec(value) : null;
  return Boolean(m && isDateKey(m[1]));
}

/** The model's answer as review rows: unknown members dropped, dates checked, lengths capped. */
export function normalizeActionItems(
  raw: ActionItemsOutputData,
  members: readonly ImportMember[],
): { items: ProposedItem[]; notes: string[] } {
  const byKey = new Map(members.map((m) => [m.key.toLowerCase(), m.userId]));
  const userOf = (key: string | null) => (key ? (byKey.get(key.trim().toLowerCase()) ?? null) : null);

  const items: ProposedItem[] = [];
  for (const item of raw.items) {
    if (items.length >= MAX_ACTION_ITEMS) break;
    const title = oneLine(item.title, 200);
    if (!title) continue;
    const ownerId = userOf(item.owner);
    const helperIds = [...new Set(item.helpers.map(userOf).filter((id): id is string => Boolean(id)))]
      .filter((id) => id !== ownerId)
      .slice(0, 10);
    const dueDate = item.dueDate && isDateKey(item.dueDate.trim()) ? item.dueDate.trim() : null;

    let kind = item.kind;
    let startsAt = isLocalDateTime(item.startsAt) ? item.startsAt : null;
    let endsAt = isLocalDateTime(item.endsAt) ? item.endsAt : null;
    let allDay = item.allDay;
    if (kind === "event") {
      if (!startsAt && dueDate) {
        // A happening with a day but no time: an all-day event.
        startsAt = `${dueDate}T00:00`;
        allDay = true;
      }
      if (!startsAt) {
        // An "event" with no day at all is really something to do.
        kind = "task";
      }
    }
    if (kind === "event" && startsAt) {
      if (allDay) {
        startsAt = `${startsAt.slice(0, 10)}T00:00`;
        endsAt = endsAt && endsAt.slice(0, 10) >= startsAt.slice(0, 10) ? `${endsAt.slice(0, 10)}T00:00` : startsAt;
      } else if (!endsAt || endsAt <= startsAt) {
        endsAt = addMinutesLocal(startsAt, 60);
      }
    } else {
      startsAt = null;
      endsAt = null;
      allDay = false;
    }

    items.push({
      key: `i${items.length + 1}`,
      kind,
      title,
      description: clean(item.description, 2_000),
      ownerId,
      helperIds,
      dueDate: kind === "event" && startsAt ? startsAt.slice(0, 10) : dueDate,
      priority: PRIORITIES.includes(item.priority) ? item.priority : "MEDIUM",
      startsAt,
      endsAt,
      allDay: kind === "event" ? allDay : false,
      location: kind === "event" ? oneLine(item.location, 300) : null,
      sourceText: clean(item.sourceText, 300) ?? title,
    });
  }
  const notes = raw.notes.map((n) => oneLine(n, 300)).filter((n): n is string => Boolean(n)).slice(0, 10);
  return { items, notes };
}

/** The member list as the model sees it: keys, names and titles, nothing else. */
export function memberRoster(members: readonly ImportMember[]): string {
  if (members.length === 0) return "(no members listed)";
  return members
    .map((m) => `${m.key}: ${m.name.replace(/\s+/g, " ").slice(0, 80)}${m.title ? ` (${m.title.replace(/\s+/g, " ").slice(0, 60)})` : ""}`)
    .join("\n");
}

/** A short date line for the prompt: "Thursday, October 1, 2026". */
export function longDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}
