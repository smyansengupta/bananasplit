/**
 * Event types, as each organization names them. Pure and client-safe.
 *
 * These were a fixed enum — Workshop, Info session, Hackathon, Social,
 * Board meeting, Other — which is one student club's vocabulary. A lab, a
 * team, a department or a society has its own, so the list is the org's
 * own rows now (EventTag) and an event points at one of them, or at none.
 *
 * COLOURS ARE A PALETTE OF THEIR OWN, not the theme's. They used to be the
 * derived chart slots (--chart-1..5), which meant a club's event types
 * changed colour whenever it changed theme, and under a monochrome theme
 * they had almost no colour at all. A type is not a data series: it is a
 * label somebody chose and expects to stay put. So the seven below are
 * fixed jewel tones — navy, plum, burgundy, rust, ochre, forest, teal —
 * named after the colour rather than a slot number, each with a light
 * value and a dark one (globals.css, --tag-*). Every one clears 4.5:1 on
 * the page, on a card and on its own 15% tint, in both modes and under
 * every preset (tag-colors.test.ts).
 *
 * Colour is never the only cue: every chip carries its type in its
 * accessible name, and every tile, row and popover names it in text.
 */

/** The colours a tag may take, in the order the picker offers them. */
export const TAG_COLORS = [
  "navy",
  "plum",
  "burgundy",
  "rust",
  "ochre",
  "forest",
  "teal",
] as const;
export type TagColor = (typeof TAG_COLORS)[number];

/** What the picker calls each colour, for its accessible name. */
export const TAG_COLOR_LABELS: Record<TagColor, string> = {
  navy: "Navy",
  plum: "Plum",
  burgundy: "Burgundy",
  rust: "Rust",
  ochre: "Ochre",
  forest: "Forest",
  teal: "Teal",
};

/**
 * What the old chart-slot colours become. Rows saved before this palette
 * existed still hold "chart-1".."chart-5"; they are read through this so a
 * club's types keep a colour, and roughly the hue they had, with no
 * migration to run.
 */
const LEGACY_TAG_COLORS: Record<string, TagColor> = {
  "chart-1": "navy",
  "chart-2": "rust",
  "chart-3": "forest",
  "chart-4": "ochre",
  "chart-5": "plum",
};

/** A stored colour read as one of today's names, or null for the neutral. */
export function tagColorOf(color: string | null | undefined): TagColor | null {
  if (!color) return null;
  if ((TAG_COLORS as readonly string[]).includes(color)) return color as TagColor;
  return LEGACY_TAG_COLORS[color] ?? null;
}

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
  { name: "Meeting", color: "navy" },
  { name: "Workshop", color: "rust" },
  { name: "Social", color: "forest" },
  { name: "Deadline", color: "burgundy" },
];

/** The CSS variable a tag's colour names. */
export function tagToken(color: string | null | undefined): string {
  const name = tagColorOf(color);
  return name ? `--tag-${name}` : "--muted-foreground";
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
