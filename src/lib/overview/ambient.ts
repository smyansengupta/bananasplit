import type { BoardWidget } from "@/lib/boards";

/**
 * Ambient Home: the member's widgets arranged by Home itself, in bands that
 * always come in the same order, so a widget always has the same spot (My
 * tasks is always top left). Widgets in a band share its height, so the
 * bottoms line up. A widget with nothing to show rests (it steps aside, and
 * the calm line under the board names it), and the widgets beside it in its
 * band take its columns, so nothing in another band moves. Custom mode is
 * the member's own arrangement instead (src/components/boards/widget-board.tsx).
 *
 * A band is eight columns on a wide screen. Each widget asks for a width;
 * a compact one (Here now with only you in) takes one column.
 */

export type Band = "you" | "now" | "calendar" | "week" | "organization";

export const BAND_COLUMNS = 8;

/** Each widget's band, by what it's about. A type not listed joins Organization. */
const BAND_OF: Record<string, Band> = {
  "my-tasks": "you",
  "since-you-were-here": "you",
  "waiting-on-you": "you",
  "waiting-on-others": "you",
  recent: "you",
  pinned: "you",
  "quick-capture": "you",
  "here-now": "now",
  meetings: "now",
  polls: "now",
  votes: "now",
  deadlines: "calendar",
  events: "calendar",
  week: "week",
  "weekly-pulse": "organization",
  decisions: "organization",
  "who-owns-what": "organization",
};

const BAND_ORDER: readonly Band[] = ["you", "now", "calendar", "week", "organization"];

/** The fixed spot of each widget within its band, first to last. */
const SPOT = Object.keys(BAND_OF);

/** Columns of eight each widget asks for. */
const WANTS: Record<string, number> = {
  "quick-capture": 2,
  "here-now": 2,
  meetings: 2,
  polls: 2,
  votes: 2,
  week: 8,
  "weekly-pulse": 8,
};
const DEFAULT_WANT = 4;

export function bandOf(type: string): Band {
  return BAND_OF[type] ?? "organization";
}

export interface AmbientState {
  /** Widget types with nothing to show right now. */
  resting: ReadonlySet<string>;
  /** Widget types that need only one column right now. */
  compact: ReadonlySet<string>;
}

export interface AmbientItem {
  widget: BoardWidget;
  /** Columns of BAND_COLUMNS. */
  span: number;
  compact: boolean;
}

export interface AmbientRow {
  band: Band;
  items: AmbientItem[];
}

function spotOf(type: string): number {
  const at = SPOT.indexOf(type);
  return at < 0 ? SPOT.length : at;
}

/** Packs one band's widgets into rows of eight; the spare columns go round the full-size ones. */
function packBand(band: Band, widgets: readonly BoardWidget[], compact: AmbientState["compact"]) {
  const rows: AmbientRow[] = [];
  let row: AmbientItem[] = [];
  let used = 0;
  const flush = () => {
    if (row.length === 0) return;
    const growable = row.filter((i) => !i.compact);
    for (let k = 0; used < BAND_COLUMNS && growable.length > 0; k++) {
      growable[k % growable.length].span += 1;
      used += 1;
    }
    rows.push({ band, items: row });
    row = [];
    used = 0;
  };
  for (const widget of widgets) {
    const small = compact.has(widget.type);
    const span = small ? 1 : Math.min(BAND_COLUMNS, WANTS[widget.type] ?? DEFAULT_WANT);
    if (used + span > BAND_COLUMNS) flush();
    row.push({ widget, span, compact: small });
    used += span;
  }
  flush();
  return rows;
}

/**
 * The member's widgets as Ambient lays them out: rows by band, each row's
 * spans adding up to BAND_COLUMNS, and the widgets that are resting.
 */
export function ambientLayout(
  layout: readonly BoardWidget[],
  state: AmbientState,
): { rows: AmbientRow[]; resting: BoardWidget[] } {
  const resting = layout.filter((w) => state.resting.has(w.type));
  const shown = layout.filter((w) => !state.resting.has(w.type));
  const rows = BAND_ORDER.flatMap((band) =>
    packBand(
      band,
      shown.filter((w) => bandOf(w.type) === band).sort((a, b) => spotOf(a.type) - spotOf(b.type)),
      state.compact,
    ),
  );
  return { rows, resting };
}
