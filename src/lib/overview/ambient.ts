import type { BoardWidget } from "@/lib/boards";

import { LEAD_MIN, NIGHT_MIN, SHARE_MIN, scoreOf, type WidgetScore } from "./priority";

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
 *
 * Your role can promote a widget into You, right after My tasks (a
 * treasurer's Waiting on you, an owner's Decisions): the same bands, but
 * what leads in them is what your role is for.
 *
 * What's going on moves things up (./priority.ts scores each widget): the
 * highest score leads in its own row above the bands, five columns of
 * eight, with My tasks beside it, or a second widget that also scores 75
 * or more. A third at 75 or more goes first in its own band. Everything
 * else keeps its usual spot. Late at night, whatever scores under 30
 * rests until morning.
 */

export type Band = "lead" | "you" | "now" | "calendar" | "week" | "organization";

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
  apps: "organization",
  decisions: "organization",
  "who-owns-what": "organization",
};

const BAND_ORDER: readonly Band[] = ["lead", "you", "now", "calendar", "week", "organization"];

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

export function bandOf(type: string, promoted?: ReadonlySet<string>): Band {
  if (promoted?.has(type)) return "you";
  return BAND_OF[type] ?? "organization";
}

export interface AmbientState {
  /** Widget types with nothing to show right now. */
  resting: ReadonlySet<string>;
  /** Widget types that need only one column right now. */
  compact: ReadonlySet<string>;
  /** Widget types your role brings into You, right after My tasks. */
  promoted?: ReadonlySet<string>;
  /** What's going on, by widget type (scoreHome). Without it, nothing leads. */
  scores?: ReadonlyMap<string, WidgetScore>;
  /** Late at night: what scores under NIGHT_MIN rests. */
  night?: boolean;
  /**
   * Widen widgets so each band's rows fill all eight columns (the default).
   * A packed grid turns it off: each keeps its own width, and the smaller
   * ones slot in under shorter neighbours instead.
   */
  fill?: boolean;
}

export interface AmbientItem {
  widget: BoardWidget;
  /** Columns of BAND_COLUMNS. */
  span: number;
  compact: boolean;
  /** Leading: why, in one line. */
  lead?: string;
}

export interface AmbientRow {
  band: Band;
  items: AmbientItem[];
}

function spotOf(type: string, promoted?: ReadonlySet<string>): number {
  // A promoted widget sits right after My tasks.
  if (promoted?.has(type)) return SPOT.indexOf("my-tasks") + 0.5;
  const at = SPOT.indexOf(type);
  return at < 0 ? SPOT.length : at;
}

/** Leading alone, these take the whole row: a catch-up story or the week's wrap reads across. */
const FULL_LEAD = new Set(["since-you-were-here", "weekly-pulse"]);

/** Packs one band's widgets into rows of eight; the spare columns go round the full-size ones. */
function packBand(
  band: Band,
  widgets: readonly BoardWidget[],
  compact: AmbientState["compact"],
  fill: boolean,
) {
  const rows: AmbientRow[] = [];
  let row: AmbientItem[] = [];
  let used = 0;
  const flush = () => {
    if (row.length === 0) return;
    const growable = fill ? row.filter((i) => !i.compact) : [];
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
  const score = (w: BoardWidget) => scoreOf(state.scores, w.type);
  const rests = (w: BoardWidget) =>
    state.resting.has(w.type) || (state.night === true && score(w) < NIGHT_MIN);
  const resting = layout.filter(rests);
  const shown = layout.filter((w) => !rests(w));

  // The lead row: the highest score, if anything is going on.
  const ranked = [...shown].sort(
    (a, b) =>
      score(b) - score(a) || spotOf(a.type, state.promoted) - spotOf(b.type, state.promoted),
  );
  const first = state.scores && ranked[0] && score(ranked[0]) >= LEAD_MIN ? ranked[0] : null;
  const lead: AmbientItem[] = [];
  if (first) {
    const second =
      ranked[1] && score(first) >= SHARE_MIN && score(ranked[1]) >= SHARE_MIN ? ranked[1] : null;
    const partner =
      second ??
      (FULL_LEAD.has(first.type)
        ? null
        : shown.find((w) => w.type === "my-tasks" && w !== first)) ??
      null;
    const why = (w: BoardWidget) => state.scores?.get(w.type)?.why;
    lead.push({
      widget: first,
      span: partner ? 5 : BAND_COLUMNS,
      compact: false,
      lead: why(first),
    });
    if (partner) {
      lead.push({
        widget: partner,
        span: 3,
        compact: false,
        ...(partner === second ? { lead: why(partner) } : {}),
      });
    }
  }
  const inLead = new Set(lead.map((i) => i.widget));
  const rest = shown.filter((w) => !inLead.has(w));
  // Within a band, anything else at SHARE_MIN or more goes first.
  const urgent = (w: BoardWidget) => (score(w) >= SHARE_MIN ? -score(w) : 0);
  const rows = BAND_ORDER.filter((b) => b !== "lead").flatMap((band) =>
    packBand(
      band,
      rest
        .filter((w) => bandOf(w.type, state.promoted) === band)
        .sort(
          (a, b) =>
            urgent(a) - urgent(b) ||
            spotOf(a.type, state.promoted) - spotOf(b.type, state.promoted),
        ),
      state.compact,
      state.fill ?? true,
    ),
  );
  return { rows: lead.length > 0 ? [{ band: "lead", items: lead }, ...rows] : rows, resting };
}
