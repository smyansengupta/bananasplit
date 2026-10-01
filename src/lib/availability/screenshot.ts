import { MAX_RULES, type Availability } from "./index";

/**
 * A block read from a schedule screenshot (src/server/availability/
 * screenshot.ts), waiting for the member's review before it joins their
 * week as a weekly rule.
 */
export interface DetectedBlock {
  label: string;
  days: number[];
  /** Whole hours, 0-23 and 1-24: the start rounded down, the end rounded up. */
  start: number;
  end: number;
  /** As read, for the review list ("9:50 AM – 11:30 AM"). */
  startText: string;
  endText: string;
}

/** Adds reviewed blocks to the week as weekly rules (never past MAX_RULES). */
export function addBlocksAsRules(value: Availability, blocks: readonly DetectedBlock[]): Availability {
  const room = Math.max(0, MAX_RULES - value.rules.length);
  const rules = blocks.slice(0, room).map((b) => ({
    kind: "weekly" as const,
    label: b.label,
    days: [...b.days].sort(),
    start: b.start,
    end: b.end,
  }));
  return { ...value, rules: [...value.rules, ...rules] };
}
