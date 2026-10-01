import { z } from "zod";

/**
 * Boards of widgets a member arranges for themselves (the Overview, the
 * Finance dashboard). A widget is a type, a width in columns (1-4 on a wide
 * screen) and a height: null to fit its content, or pixels (dragged, or
 * picked from the presets). Saved per member and per org in MemberPrefs.
 */

export const BOARD_COLUMNS = 4;
export const MIN_HEIGHT = 120;
export const MAX_HEIGHT = 1200;
export const HEIGHT_STEP = 20;
export const MAX_WIDGETS = 30;

export const HEIGHT_PRESETS = [
  { label: "Fit", value: null },
  { label: "S", value: 200 },
  { label: "M", value: 340 },
  { label: "L", value: 520 },
] as const;

export interface WidgetMeta {
  type: string;
  title: string;
  description: string;
  group: string;
  /** lucide icon name, resolved by the board. */
  icon: string;
  w: number;
  h: number | null;
}

export interface BoardWidget {
  id: string;
  type: string;
  w: number;
  h: number | null;
}

export function clampWidth(w: number): number {
  return Math.min(BOARD_COLUMNS, Math.max(1, Math.round(w)));
}

export function clampHeight(h: number | null): number | null {
  if (h === null) return null;
  const snapped = Math.round(h / HEIGHT_STEP) * HEIGHT_STEP;
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, snapped));
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
    out.push({ id, type, w: clampWidth(w), h: clampHeight(item.data.h ?? null) });
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
        h: z.number().int().min(MIN_HEIGHT).max(MAX_HEIGHT).nullable(),
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
