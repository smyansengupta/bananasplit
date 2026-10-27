/**
 * The tag palette: the colours a club picks for the things it names.
 * Pure and client-safe.
 *
 * NOT src/lib/label-colors.ts, which is a different thing with a similar
 * name: that one is the raw hexes a member picks for a TASK LABEL. This
 * one is theme tokens for the things a club names.
 *
 * Event kinds, note folders and epics all wanted the same thing and all
 * took the derived chart slots (--chart-1..5) instead. That had two costs.
 * A club's labels changed colour whenever it changed theme, which is wrong
 * for something somebody chose on purpose; and under a monochrome theme
 * like Graphite the slots are nearly grey, so a shelf of folders or a page
 * of meetings had no colour in it at all.
 *
 * THESE ARE FIXED VALUES AND A THEME DOES NOT OVERRIDE THEM. Seven jewel
 * tones, named after the colour rather than a slot number, each with a
 * light value and a dark one in globals.css (--tag-*). A label is not a
 * data series: --chart-1..5 stay exactly as they were, derived per theme
 * and checked by src/lib/theme/chart.ts, and charts and meters still use
 * them.
 *
 * Every colour clears 4.5:1 on the page, on a card and on its own 15%
 * tint, in both modes and under every preset the app ships; the chroma
 * floor keeps each one reading as a colour rather than a grey, and
 * adjacent hues stay apart. tag-colors.test.ts is what holds all of
 * that, and it is the reason burgundy and rust are lighter in dark mode
 * than they first were — they failed on Banana cream.
 *
 * Colour is never the only cue: every chip carries its name in its
 * accessible name, and every tile, row and popover names it in text.
 */

/** The palette, in the order a picker offers it. */
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

/** What a picker calls each colour, for its accessible name. */
export const TAG_COLOR_NAMES: Record<TagColor, string> = {
  navy: "Navy",
  plum: "Plum",
  burgundy: "Burgundy",
  rust: "Rust",
  ochre: "Ochre",
  forest: "Forest",
  teal: "Teal",
};

/**
 * What the chart slots a label used to hold become. Folder rows saved
 * before this palette still say "chart-1".."chart-5"; they are read
 * through here onto the nearest hue, so nothing has to be migrated and
 * nobody's folder turns grey.
 */
const SLOT_COLORS: Record<string, TagColor> = {
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
  return SLOT_COLORS[color] ?? null;
}

/** The CSS variable a stored colour names; the neutral when it has none. */
export function tagToken(color: string | null | undefined): string {
  const name = tagColorOf(color);
  return name ? `--tag-${name}` : "--muted-foreground";
}

/** The same as a CSS value, ready for a style prop. */
export function tagVar(color: string | null | undefined): string {
  return `var(${tagToken(color)})`;
}
