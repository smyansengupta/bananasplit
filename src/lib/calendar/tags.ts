/**
 * Event types, as each organization names them. Pure and client-safe.
 *
 * These were a fixed enum — Workshop, Info session, Hackathon, Social,
 * Board meeting, Other — which is one student club's vocabulary. A lab, a
 * team, a department or a society has its own, so the list is the org's
 * own rows now (EventTag) and an event points at one of them, or at none.
 *
 * COLOURS ARE THEME TOKENS, not fixed values: a tag names a CSS variable,
 * so an org's theme restyles the calendar with everything else (Settings >
 * Theme). --chart-1..5 are the derived categorical palette, checked per
 * theme for a lightness band, a chroma floor, colour-blind separation
 * between adjacent slots and 3:1 against both surfaces (src/lib/theme/
 * chart.ts), which is what a row of event types needs. A tag with no
 * colour takes the neutral, as the old "Other" did.
 *
 * Colour is never the only cue: every chip carries its type in its
 * accessible name, and every tile, row and popover names it in text.
 */

/** The colours a tag may take, in the order the picker offers them. */
export const TAG_COLORS = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"] as const;
export type TagColor = (typeof TAG_COLORS)[number];

export const MAX_TAG_NAME = 40;
/** Enough for any org's list without the filter row becoming a wall. */
export const MAX_TAGS_PER_ORG = 12;

export interface EventTagOption {
  id: string;
  name: string;
  /** A TAG_COLORS member, or null for the neutral. */
  color: string | null;
}

/**
 * What a new organization starts with: four words that mean something to
 * any of them, and that are meant to be rewritten. The migration gave
 * every existing org the same set, plus whatever its own events were
 * already using.
 */
export const STARTER_TAGS: readonly { name: string; color: TagColor }[] = [
  { name: "Meeting", color: "chart-1" },
  { name: "Workshop", color: "chart-2" },
  { name: "Social", color: "chart-3" },
  { name: "Deadline", color: "chart-4" },
];

/** The CSS variable a tag's colour names. */
export function tagToken(color: string | null | undefined): string {
  return color && (TAG_COLORS as readonly string[]).includes(color)
    ? `--${color}`
    : "--muted-foreground";
}

/**
 * The style object that puts a tag's colour on an element as `--kind`.
 * Everything in calendar.css paints from that one variable, so a chip, a
 * dot, a bar and a time-grid block all follow the same token.
 */
export function tagStyle(color: string | null | undefined): React.CSSProperties {
  return { ["--kind" as string]: `var(${tagToken(color)})` };
}

/** What an event with no type is called, wherever one has to be named. */
export const NO_TAG_LABEL = "No type";

/** A tag's name trimmed and capped, or null if nothing is left. */
export function cleanTagName(name: string): string | null {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, MAX_TAG_NAME);
  return clean.length > 0 ? clean : null;
}

/** Finds a tag by name, ignoring case and surrounding space. */
export function findTag<T extends { name: string }>(
  tags: readonly T[],
  name: string | null | undefined,
): T | undefined {
  const needle = (name ?? "").trim().toLocaleLowerCase();
  if (!needle) return undefined;
  return tags.find((t) => t.name.trim().toLocaleLowerCase() === needle);
}
