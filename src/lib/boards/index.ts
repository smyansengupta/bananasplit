import { z } from "zod";

/**
 * Boards of widgets a member arranges for themselves (the Overview, the
 * Finance dashboard). A widget is a type, a width in columns (1-4 on a wide
 * screen) and a height in rows, where a row is as tall as a column is wide:
 * 1 column by 1 row is a square, 2 by 2 a bigger square. A null height fits
 * its content instead. Saved per member and per org in MemberPrefs.
 */

export const BOARD_COLUMNS = 4;
export const MAX_ROWS = 3;
export const MAX_WIDGETS = 30;
/** What a saved height in pixels (the old boards) is worth in rows. */
const LEGACY_ROW_PX = 280;

/**
 * Each shape's name, by width then rows. Customize offers these, and the
 * corner drag reads them back as you resize.
 */
const SHAPE_NAMES: Record<number, readonly [string, string, string]> = {
  1: ["Square", "Tall", "Tower"],
  2: ["Rectangle", "Big square", "Tall rectangle"],
  3: ["Wide rectangle", "Big rectangle", "Huge square"],
  4: ["Full rectangle", "Big full rectangle", "Full page"],
};
const FIT_NAMES: Record<number, string> = {
  1: "Narrow",
  2: "Half width",
  3: "Three quarters",
  4: "Full width",
};

/** "Big square", or "Half width" for a widget that fits its content. */
export function shapeName(w: number, h: number | null): string {
  const width = clampWidth(w);
  if (h === null) return FIT_NAMES[width];
  return SHAPE_NAMES[width][clampRows(h) - 1];
}

export interface WidgetMeta {
  type: string;
  title: string;
  description: string;
  group: string;
  /** Icon name (@/components/icons), resolved by the board. */
  icon: string;
  w: number;
  h: number | null;
  /**
   * "card" (the default): the board frames it as a surface card with its
   * title. "bare": the body draws its own surface (a row of block cards, a
   * goal block), so the board only adds the edit controls while customizing.
   */
  frame?: "card" | "bare";
}

export interface BoardWidget {
  id: string;
  type: string;
  /** Columns, 1 to BOARD_COLUMNS. */
  w: number;
  /** Rows, 1 to MAX_ROWS; null fits the content. */
  h: number | null;
}

export function clampWidth(w: number): number {
  return Math.min(BOARD_COLUMNS, Math.max(1, Math.round(w)));
}

export function clampRows(h: number): number {
  return Math.min(MAX_ROWS, Math.max(1, Math.round(h)));
}

/** A saved height as rows: old boards saved pixels, which round to the nearest rows. */
export function readHeight(h: number | null): number | null {
  if (h === null) return null;
  return clampRows(h > MAX_ROWS ? h / LEGACY_ROW_PX : h);
}

const LEGACY_WIDTH: Record<string, number> = { sm: 1, md: 2, lg: 4 };

/** Parses a saved board against the known types; also reads the old { size } shape. */
export function parseBoard(saved: unknown, types: readonly string[]): BoardWidget[] | null {
  if (!Array.isArray(saved) || saved.length > MAX_WIDGETS) return null;
  const known = new Set(types);
  const ids = new Set<string>();
  const out: BoardWidget[] = [];
  for (const raw of saved) {
    const item = z
      .object({
        id: z.string().regex(/^[a-z0-9-]{1,40}$/),
        type: z.string(),
        w: z.number().optional(),
        h: z.number().nullable().optional(),
        size: z.enum(["sm", "md", "lg"]).optional(),
      })
      .safeParse(raw);
    if (!item.success) return null;
    const { id, type } = item.data;
    if (!known.has(type) || ids.has(id)) continue;
    ids.add(id);
    const w = item.data.w ?? (item.data.size ? LEGACY_WIDTH[item.data.size] : 1);
    out.push({ id, type, w: clampWidth(w), h: readHeight(item.data.h ?? null) });
  }
  return out;
}

export const boardInputSchema = z
  .array(
    z
      .object({
        id: z.string().regex(/^[a-z0-9-]{1,40}$/),
        type: z.string().max(40),
        w: z.number().int().min(1).max(BOARD_COLUMNS),
        h: z.number().int().min(1).max(MAX_ROWS).nullable(),
      })
      .strict(),
  )
  .max(MAX_WIDGETS);

/** A fresh id for a widget of `type` not already on the board. */
export function newWidgetId(type: string, layout: readonly { id: string }[]): string {
  const taken = new Set(layout.map((w) => w.id));
  if (!taken.has(type)) return type;
  for (let i = 2; ; i++) if (!taken.has(`${type}-${i}`)) return `${type}-${i}`;
}
