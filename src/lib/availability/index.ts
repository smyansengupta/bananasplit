import { z } from "zod";

/**
 * When a member can't meet (onboarding A5, and the profile page). Pure and
 * client-safe: the grid, the Server Action and every read use these rules.
 *
 * Stored on User.availability as { v: 1, blocks, rules }:
 * - blocks: hours blocked by hand, as "day-hour" keys ("0-9" = Monday 9 AM).
 * - rules:  "never" (an hour every day, or a whole weekday), "weekly" (a
 *           labelled recurring event on some weekdays) and "date" (one
 *           labelled date, all day or between two hours).
 *
 * Labels are private to the user. Other members only ever get
 * busyCells(), which has no labels in it.
 */

/** Monday first, like the grid. */
export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const DAY_SHORT = ["M", "T", "W", "T", "F", "S", "S"] as const;
/** The grid's hours: 8 AM to 10 PM (the last row is 10-11 PM). */
export const FIRST_HOUR = 8;
export const LAST_HOUR = 22;
export const GRID_HOURS: readonly number[] = Array.from(
  { length: LAST_HOUR - FIRST_HOUR + 1 },
  (_, i) => FIRST_HOUR + i,
);

export const MAX_RULES = 20;
export const MAX_RULE_LABEL = 60;

export type CellKind = "never" | "weekly";

/** "9a", "12p", "5p" */
export function hourLabel(hour: number): string {
  const h = ((hour + 11) % 12) + 1;
  return `${h}${hour < 12 ? "a" : "p"}`;
}

/** "9 AM", "12 PM" */
export function hourLabelLong(hour: number): string {
  const h = ((hour + 11) % 12) + 1;
  return `${h} ${hour < 12 || hour === 24 ? "AM" : "PM"}`;
}

export function cellKey(day: number, hour: number): string {
  return `${day}-${hour}`;
}

const dayIndex = z.number().int().min(0).max(6);
const hour = z.number().int().min(0).max(24);
const label = z
  .string()
  .transform((s) => s.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1, "Give it a name.").max(MAX_RULE_LABEL, `Keep it under ${MAX_RULE_LABEL} characters.`));

const neverHourRule = z
  .object({ kind: z.literal("never"), scope: z.literal("hour"), hour: hour.max(23) })
  .strict();
const neverDayRule = z.object({ kind: z.literal("never"), scope: z.literal("day"), day: dayIndex }).strict();
const weeklyRule = z
  .object({
    kind: z.literal("weekly"),
    label,
    days: z.array(dayIndex).min(1, "Pick at least one day.").max(7),
    start: hour.max(23),
    end: hour.min(1),
  })
  .strict()
  .refine((r) => r.end > r.start, { message: "The end must be after the start.", path: ["end"] });
const dateRule = z
  .object({
    kind: z.literal("date"),
    label,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date."),
    start: hour.max(23).nullable(),
    end: hour.min(1).nullable(),
  })
  .strict()
  .refine((r) => (r.start === null) === (r.end === null), {
    message: "Give both times, or neither for all day.",
    path: ["end"],
  })
  .refine((r) => r.start === null || r.end === null || r.end > r.start, {
    message: "The end must be after the start.",
    path: ["end"],
  });

export const availabilityRuleSchema = z.union([neverHourRule, neverDayRule, weeklyRule, dateRule]);
export type AvailabilityRule = z.output<typeof availabilityRuleSchema>;

const blockKey = z.string().regex(/^[0-6]-([0-9]|1[0-9]|2[0-3])$/);

export const availabilitySchema = z
  .object({
    v: z.literal(1).optional().default(1),
    blocks: z.array(blockKey).max(7 * 24).optional().default([]),
    rules: z.array(availabilityRuleSchema).max(MAX_RULES, `Add at most ${MAX_RULES} rules.`).optional().default([]),
  })
  .strict()
  .transform((a) => ({ v: 1 as const, blocks: [...new Set(a.blocks)].sort(), rules: a.rules }));

export type Availability = z.output<typeof availabilitySchema>;

export const EMPTY_AVAILABILITY: Availability = { v: 1, blocks: [], rules: [] };

/** A stored value, or empty when it is missing or malformed. Never throws. */
export function parseAvailability(raw: unknown): Availability {
  const parsed = availabilitySchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_AVAILABILITY;
}

/**
 * Every blocked hour of a typical week, and why: "weekly" for a recurring
 * event, "never" for everything else. Date rules are one-offs and are not
 * part of the weekly grid.
 */
export function weeklyCells(a: Availability): Map<string, CellKind> {
  const out = new Map<string, CellKind>();
  for (const key of a.blocks) out.set(key, "never");
  for (const rule of a.rules) {
    if (rule.kind === "never" && rule.scope === "hour") {
      for (let d = 0; d < 7; d++) out.set(cellKey(d, rule.hour), "never");
    } else if (rule.kind === "never" && rule.scope === "day") {
      for (let h = 0; h < 24; h++) out.set(cellKey(rule.day, h), "never");
    } else if (rule.kind === "weekly") {
      for (const d of rule.days) {
        for (let h = rule.start; h < rule.end; h++) {
          if (!out.has(cellKey(d, h))) out.set(cellKey(d, h), "weekly");
        }
      }
    }
  }
  return out;
}

/** Blocked hours per week inside the grid's hours (the review screen's count). */
export function blockedHoursPerWeek(a: Availability): number {
  let n = 0;
  for (const key of weeklyCells(a).keys()) {
    const h = Number(key.split("-")[1]);
    if (h >= FIRST_HOUR && h <= LAST_HOUR) n++;
  }
  return n;
}

/**
 * What another member may see: the busy hours of a typical week, nothing
 * else (no labels, no dates, no reason).
 */
export function busyCells(a: Availability): string[] {
  return [...weeklyCells(a).keys()].sort();
}

/** Toggles a hand-set block; a cell that a rule blocks is left to the rule. */
export function toggleBlock(a: Availability, key: string, on: boolean): Availability {
  const set = new Set(a.blocks);
  if (on) set.add(key);
  else set.delete(key);
  return { ...a, blocks: [...set].sort() };
}

function formatDays(days: readonly number[]): string {
  const sorted = [...days].sort((x, y) => x - y);
  if (sorted.length === 7) return "every day";
  if (sorted.join(",") === "0,1,2,3,4") return "weekdays";
  if (sorted.join(",") === "5,6") return "weekends";
  return sorted.map((d) => DAY_LABELS[d]).join(", ");
}

function formatRange(start: number, end: number): string {
  const s = hourLabelLong(start);
  const e = hourLabelLong(end);
  const sameHalf = (start < 12) === (end < 12 || end === 24);
  return sameHalf ? `${s.split(" ")[0]}–${e}` : `${s}–${e}`;
}

/** The rule list's text: [badge, title, when]. */
export function describeRule(rule: AvailabilityRule): { badge: string; title: string; when: string } {
  switch (rule.kind) {
    case "never":
      return rule.scope === "hour"
        ? { badge: "NEVER", title: `I can never meet at ${hourLabelLong(rule.hour)}`, when: "every day" }
        : { badge: "NEVER", title: `No meetings on ${DAY_LABELS[rule.day]}s`, when: "all day" };
    case "weekly":
      return { badge: "WEEKLY", title: rule.label, when: `${formatDays(rule.days)} ${formatRange(rule.start, rule.end)}` };
    case "date": {
      const d = new Date(`${rule.date}T12:00:00Z`);
      const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
      return {
        badge: "DATE",
        title: rule.label,
        when: rule.start === null || rule.end === null ? `${day}, all day` : `${day}, ${formatRange(rule.start, rule.end)}`,
      };
    }
  }
}
