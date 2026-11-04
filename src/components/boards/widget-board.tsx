"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragOverEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable } from "@dnd-kit/sortable";
import {
  Activity,
  AlarmClock,
  ArrowLeftRight,
  CalendarDays,
  CalendarRange,
  ChartBar,
  ChartColumn,
  ChartLine,
  ChartPie,
  Check,
  CheckSquare,
  ClipboardList,
  Clock,
  Eye,
  Filter,
  FolderOpen,
  GripVertical,
  HandCoins,
  Handshake,
  Hash,
  LayoutGrid,
  Hourglass,
  Link2,
  ListChecks,
  NotebookText,
  Pencil,
  PiggyBank,
  Pin,
  Plus,
  ReceiptText,
  Rocket,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sunrise,
  Table2,
  Target,
  Ticket,
  Timer,
  TrendingDown,
  Trophy,
  Users,
  Vote,
  Wallet,
  X,
  Zap,
  type IconComponent,
} from "@/components/icons";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
  type RefObject,
} from "react";

import { AmbientWhy } from "@/components/ambient/ambient-button";
import { ShapeIcon, ShapePicker } from "@/components/boards/shape-picker";
import { Badge } from "@/components/ui/badge";
import { InBar } from "@/components/ui/bar-slot";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { IconChip } from "@/components/ui/stat";
import {
  BOARD_COLUMNS,
  MAX_ROWS,
  MAX_WIDGETS,
  fillRows,
  newWidgetId,
  shapeName,
  type BoardWidget,
  type WidgetMeta,
} from "@/lib/boards";
import { ambientLayout } from "@/lib/overview/ambient";
import { packSegment } from "@/lib/overview/pack";
import type { WidgetScore } from "@/lib/overview/priority";
import { overlayOpen } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

export const BOARD_ICONS: Record<string, IconComponent> = {
  Activity,
  AlarmClock,
  ArrowLeftRight,
  CalendarDays,
  CalendarRange,
  ChartBar,
  ChartColumn,
  ChartLine,
  ChartPie,
  CheckSquare,
  ClipboardList,
  Clock,
  Filter,
  FolderOpen,
  HandCoins,
  Handshake,
  Hash,
  Hourglass,
  Link2,
  ListChecks,
  NotebookText,
  PiggyBank,
  Pin,
  ReceiptText,
  Rocket,
  ShieldCheck,
  Sparkles,
  Table2,
  Target,
  Ticket,
  Timer,
  TrendingDown,
  Trophy,
  Users,
  Vote,
  Wallet,
  Zap,
};

const SPAN: Record<number, string> = {
  1: "col-span-1",
  2: "col-span-1 sm:col-span-2",
  3: "col-span-1 sm:col-span-2 lg:col-span-3",
  4: "col-span-1 sm:col-span-2 lg:col-span-4",
};

/**
 * Ambient is one grid, eight columns on a wide screen, two on a tablet, one
 * on a phone. Now's widgets are small, so they sit two across (four columns
 * each) until the widest screens. On two columns a full-size widget takes
 * both; Now's pair up, and a lone one (or the last of an odd count) takes both.
 */
const BAND_SPAN_LG: Record<number, string> = {
  1: "lg:col-span-1",
  2: "lg:col-span-2",
  3: "lg:col-span-3",
  4: "lg:col-span-4",
  5: "lg:col-span-5",
  6: "lg:col-span-6",
  7: "lg:col-span-7",
  8: "lg:col-span-8",
};
const BAND_SPAN_XL: Record<number, string> = {
  1: "xl:col-span-1",
  2: "xl:col-span-2",
  3: "xl:col-span-3",
  4: "xl:col-span-4",
  5: "xl:col-span-5",
  6: "xl:col-span-6",
  7: "xl:col-span-7",
  8: "xl:col-span-8",
};
/** Focus time beside the week: three columns of eight until the widest screens. */
const BESIDE_WEEK_SPAN: Record<number, string> = {
  2: "lg:col-span-3 xl:col-span-2",
  6: "lg:col-span-5 xl:col-span-6",
};
function bandSpan(band: { name: string; span: number; square: boolean; full: boolean }): string {
  const two = band.full ? "sm:col-span-2" : "sm:col-span-1";
  if (band.name === "week" && BESIDE_WEEK_SPAN[band.span]) {
    return cn("col-span-1", two, BESIDE_WEEK_SPAN[band.span]);
  }
  return band.square
    ? cn("col-span-1", two, band.full ? "lg:col-span-8" : "lg:col-span-4", BAND_SPAN_XL[band.span])
    : cn("col-span-1", two, BAND_SPAN_LG[band.span]);
}

const PACK_GAP = 18;
/**
 * Ambient's grid. Until the widgets are measured it's an ordinary grid;
 * then usePacked places each one itself (data-packed).
 */
const PACKED_GRID =
  "grid grid-cols-1 items-start gap-4.5 sm:grid-cols-2 lg:grid-cols-8 data-[packed]:block sm:[--board-row:clamp(14rem,calc((100cqw_-_1.125rem)/2),22rem)] lg:[--board-row:clamp(15rem,calc((100cqw_-_3.375rem)/4),22rem)]";

/** Columns Ambient may use at a width: three on a wide screen, two on a tablet, one on a phone. */
function packColumns(width: number): number {
  if (width >= 960) return 3;
  return width >= 560 ? 2 : 1;
}

/**
 * Places Ambient's widgets (packSegment): each as tall as what's in it, in
 * columns that all end at the same line, so there's no hole anywhere. A
 * wide widget (data-wide) takes a whole row. Again whenever a widget or the
 * board changes size.
 */
function usePacked(grid: RefObject<HTMLDivElement | null>, key: unknown) {
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const items = () =>
      Array.from(el.children).filter((c): c is HTMLElement => c instanceof HTMLElement);
    const PLACED = ["position", "left", "top", "width", "min-height"];
    const reset = (item: HTMLElement) => PLACED.forEach((p) => item.style.removeProperty(p));
    let frame = 0;
    // Placing again gives the same sizes, so the observer seeing our own
    // changes settles after one more frame.
    const fit = () => {
      frame = 0;
      el.setAttribute("data-packed", "");
      const width = el.getBoundingClientRect().width;
      const list = items().filter((item) => getComputedStyle(item).display !== "none");
      list.forEach((item) => {
        reset(item);
        item.style.setProperty("position", "absolute");
      });
      const heightAt = (item: HTMLElement, w: number) => {
        item.style.setProperty("width", `${w}px`);
        return item.getBoundingClientRect().height;
      };
      const colWidth = (k: number) => (width - PACK_GAP * (k - 1)) / k;
      // Wide widgets split the rest into segments.
      const segments: HTMLElement[][] = [[]];
      const order: (HTMLElement | HTMLElement[])[] = [];
      for (const item of list) {
        if (item.hasAttribute("data-wide")) {
          order.push(item);
          segments.push([]);
        } else {
          const seg = segments[segments.length - 1]!;
          if (seg.length === 0) order.push(seg);
          seg.push(item);
        }
      }
      let top = 0;
      for (const part of order) {
        if (part instanceof HTMLElement) {
          const h = heightAt(part, width);
          part.style.setProperty("left", "0px");
          part.style.setProperty("top", `${top}px`);
          top += h + PACK_GAP;
          continue;
        }
        const seg = packSegment(
          (k) => part.map((item) => heightAt(item, colWidth(k))),
          part.length,
          packColumns(width),
          PACK_GAP,
        );
        const w = colWidth(seg.cols);
        const heights = part.map((item) => heightAt(item, w));
        seg.columns.forEach((column, k) => {
          let y = top;
          for (const i of column) {
            const item = part[i]!;
            const h = heights[i]! + seg.extra[i]!;
            item.style.setProperty("left", `${k * (w + PACK_GAP)}px`);
            item.style.setProperty("top", `${y}px`);
            if (seg.extra[i]! > 0) item.style.setProperty("min-height", `${h}px`);
            y += h + PACK_GAP;
          }
        });
        top += seg.height + PACK_GAP;
      }
      el.style.setProperty("height", `${Math.max(0, top - PACK_GAP)}px`);
    };
    fit();
    const watch = new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(fit);
    });
    watch.observe(el);
    for (const item of items()) watch.observe(item);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      watch.disconnect();
      el.removeAttribute("data-packed");
      el.style.removeProperty("height");
      for (const item of items()) reset(item);
    };
  }, [grid, key]);
}

/** Home's two layouts: Ambient arranges itself, Custom is the member's own. */
export type BoardMode = "ambient" | "custom";

/** What a board needs to offer Ambient (Home only). */
export interface AmbientProps {
  mode: BoardMode;
  /** Widget types with nothing to show right now. */
  resting: readonly string[];
  /** Widget types that need only one column right now (Here now with just you). */
  compact: readonly string[];
  /**
   * Widgets Ambient shows whether or not they're on the member's board
   * (From your apps, what their role is for). Never saved to Custom.
   */
  extras?: readonly BoardWidget[];
  /** Widget types the member's role brings into You, right after My tasks. */
  promoted?: readonly string[];
  /** What's going on, by widget type (scoreHome): the highest leads. */
  scores?: Readonly<Record<string, WidgetScore>>;
  /** Late at night: what scores low rests until morning. */
  night?: boolean;
  onMode: (mode: BoardMode) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * A row is as tall as a column is wide, so 1 by 1 is a square: the board is
 * a size container and --board-row is one column's width (the gap is 4.5,
 * 1.125rem). A widget with rows spans them and is exactly that tall.
 */
const GRID =
  "grid grid-cols-1 gap-4.5 sm:grid-cols-2 lg:grid-cols-4 sm:[--board-row:clamp(14rem,calc((100cqw_-_1.125rem)/2),22rem)] lg:[--board-row:clamp(15rem,calc((100cqw_-_3.375rem)/4),22rem)]";
/** Rows on a tablet or computer; a phone's widgets are as tall as what's in them. */
const ROWS_TALL =
  "sm:h-[calc(var(--board-row)*var(--rows)_+_1.125rem*(var(--rows)_-_1))] sm:[grid-row:span_var(--rows)]";

/** A touch screen: a widget moves by its grip, so a swipe anywhere else still scrolls the page. */
function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    (change) => {
      const query = window.matchMedia("(pointer: coarse)");
      query.addEventListener("change", change);
      return () => query.removeEventListener("change", change);
    },
    () => window.matchMedia("(pointer: coarse)").matches,
    () => false,
  );
}

/** The item under the pointer, or the nearest one when it's between them. */
const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : closestCenter(args);
};

const noSubscribe = () => () => {};

/**
 * What a save sends back. A Reset (null) may answer with the board it put
 * back, which the board shows at once, and an undo that puts the old one
 * back exactly (a report's widget settings too) and answers with that board.
 */
export type SaveBoardResult = {
  ok: boolean;
  error?: string;
  layout?: BoardWidget[];
  undo?: () => Promise<{ ok: boolean; error?: string; layout?: BoardWidget[] }>;
};

export type SaveBoard = (layout: BoardWidget[] | null) => Promise<SaveBoardResult>;

/**
 * The board's widgets slide to their new places when the layout changes
 * (a move, a resize, an add): each one's last spot is kept, relative to the
 * grid so scrolling doesn't count, and it animates from there.
 */
function useReflow(grid: RefObject<HTMLDivElement | null>, layout: unknown) {
  const spots = useRef(new Map<string, { x: number; y: number }>());
  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, { x: number; y: number }>();
    for (const node of el.querySelectorAll<HTMLElement>("[data-widget-id]")) {
      const id = node.dataset.widgetId ?? "";
      // Layout offsets (the grid is the offset parent), which a slide still
      // under way doesn't move: measuring mid-slide would start another.
      const spot = { x: node.offsetLeft, y: node.offsetTop };
      next.set(id, spot);
      const was = spots.current.get(id);
      if (!was || still) continue;
      const dx = was.x - spot.x;
      const dy = was.y - spot.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      for (const running of node.getAnimations()) running.cancel();
      node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
        duration: 260,
        easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      });
    }
    spots.current = next;
  }, [grid, layout]);
}

/**
 * A member's own board of widgets.
 *
 * Reading it is just the widgets, in the order the member put them, each in
 * its shape: a row is as tall as a column is wide, so a widget is a Square, a
 * Rectangle, a Big square, a Full rectangle and so on, or it fits its
 * content. Nothing is packed out of order to fill a gap.
 *
 * The + beside Customize adds a widget, and every widget has an x (on hover)
 * that takes it off with Undo. Customize is a switch for the rest: drag a
 * widget anywhere on it to move it (the others slide out of the way; its
 * handle moves it with the arrow keys too), drag its corner to resize it
 * cell by cell, or pick its shape from a grid. Every change saves itself, so
 * Done (or Esc) just ends it. Only the member's own board changes.
 *
 * Not on a phone: there the board is read, not arranged, so Customize is a
 * computer thing, and `hiddenOnPhone` widgets (the Overview's Recently
 * visited) are left out.
 */
export function WidgetBoard({
  types,
  initialLayout,
  customized,
  bodies,
  renderBody,
  onSave,
  intro,
  introDescription,
  notice,
  headerActions,
  belowIntro,
  footer,
  hiddenOnPhone = [],
  titles,
  readOnly = false,
  editHint = "Only you see your board.",
  resetLabel = "Reset to the default board",
  startEditing = false,
  refreshOnSave = true,
  noun = "your board",
  fillGaps = false,
  ambient,
}: {
  types: readonly WidgetMeta[];
  initialLayout: BoardWidget[];
  customized: boolean;
  /** Pre-rendered widget bodies by type (from a server component). */
  bodies?: Readonly<Record<string, ReactNode>>;
  /** Or a render function (from a client wrapper). */
  renderBody?: (type: string) => ReactNode;
  onSave: SaveBoard;
  /** What sits on the left of the Customize button (a page's title, a line of text). */
  intro?: ReactNode;
  /**
   * The line under the title. It goes BELOW the title's row, not inside it,
   * so Customize stays level with the title (PageHeader does the same).
   */
  introDescription?: ReactNode;
  /** Something to say above the widgets (a setup prompt), under the title row. */
  notice?: ReactNode;
  /**
   * A card's header controls by widget type (a count chip, ••• and ↗, in
   * that order after the title), shown while not customizing.
   */
  headerActions?: Readonly<Record<string, ReactNode>>;
  /** A full-width line under the title row (the Overview's stat strip). */
  belowIntro?: ReactNode;
  /** Below the widgets (the Overview's setup prompt, so Up next stays first). */
  footer?: ReactNode;
  /** Widget types a phone leaves out. */
  hiddenOnPhone?: readonly string[];
  /**
   * Titles by widget id, where two widgets of a type say different things (a
   * saved report's "Amount by category" and "Sponsors by stage"). Bodies and
   * header actions are looked up by id too, then by type.
   */
  titles?: Readonly<Record<string, string>>;
  /** Shown, not arranged: no +, Customize or remove (a report someone else made). */
  readOnly?: boolean;
  /** The first words of the Customize hint (whose board changes). */
  editHint?: string;
  /** What Reset puts back. */
  resetLabel?: string;
  /** Opens in Customize (the New report walkthrough's Arrange step). */
  startEditing?: boolean;
  /** Re-reads the page after each save; off where the board only feeds a form. */
  refreshOnSave?: boolean;
  /** What the widgets are on, in its messages ("your board", "this report"). */
  noun?: string;
  /** Close up the rows when a widget is added or removed (a saved report). */
  fillGaps?: boolean;
  /**
   * Offers Ambient beside Custom (Home). In Ambient the board is laid out in
   * bands by src/lib/overview/ambient.ts, resting widgets step aside, and
   * there's nothing to drag; Custom is the board as the member arranged it.
   */
  ambient?: AmbientProps;
}) {
  const router = useRouter();
  const [layout, setLayout] = useState(initialLayout);
  const [editing, setEditing] = useState(startEditing);
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [mode, setMode] = useState<BoardMode>(ambient?.mode ?? "custom");
  // Nothing moves while you're looking: what leads is held from when the
  // page opened, and takes the latest only when you come back to the tab.
  const [scores, setScores] = useState(ambient?.scores);
  const latestScores = useRef(ambient?.scores);
  useEffect(() => {
    latestScores.current = ambient?.scores;
  }, [ambient?.scores]);
  useEffect(() => {
    const back = () => {
      if (document.visibilityState === "visible") setScores(latestScores.current);
    };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, []);
  const grid = useRef<HTMLDivElement>(null);
  const packed = useRef<HTMLDivElement>(null);
  const beforeDrag = useRef<BoardWidget[] | null>(null);
  const lastSwap = useRef<string | null>(null);
  const meta = new Map(types.map((t) => [t.type, t]));
  const groups = [...new Set(types.map((t) => t.group))];
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  useReflow(grid, layout);
  // The drag preview goes on the body, which is only there in the browser.
  const browser = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );

  /** Set by a Reset: take the next layout the server sends. */
  const takeNext = useRef(false);

  function persist(next: BoardWidget[] | null, then?: (result: SaveBoardResult) => void) {
    setError(null);
    start(async () => {
      const result = await onSave(next);
      if (!result.ok) {
        setError(result.error ?? "Couldn't save the layout. Check your connection and try again.");
        return;
      }
      // Reset: when the save says what it put back, show it now. Otherwise
      // the server's default arrives with the refresh; take it then.
      if (next === null) {
        if (result.layout) take(result.layout);
        else takeNext.current = true;
      }
      then?.(result);
      if (refreshOnSave) router.refresh();
    });
  }

  // The board saves as you go: every change (a remove, an add, a drag) is
  // sent a moment after the last one, so there is no Save or Cancel.
  const saved = useRef(JSON.stringify(initialLayout));
  /** Shows a board that is already saved (what a Reset or its Undo put back). */
  function take(next: BoardWidget[]) {
    saved.current = JSON.stringify(next);
    setLayout(next);
  }
  useEffect(() => {
    if (dragId) return;
    const now = JSON.stringify(layout);
    if (now === saved.current) return;
    const timer = setTimeout(() => {
      saved.current = now;
      persist(layout);
    }, 600);
    return () => clearTimeout(timer);
    // persist is stable enough here: it only reads onSave and the router.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, dragId]);

  // After a Reset, the default the server sends back replaces the board (and
  // counts as saved). Otherwise the board is the person's: a refresh never
  // overwrites a change they've just made.
  const incoming = JSON.stringify(initialLayout);
  useEffect(() => {
    if (!takeNext.current) return;
    takeNext.current = false;
    saved.current = incoming;
    setLayout(JSON.parse(incoming) as BoardWidget[]);
  }, [incoming]);

  /** A report closes its rows up as widgets come and go; Home leaves them as they are. */
  const arrange = (next: BoardWidget[]) => (fillGaps ? fillRows(next) : next);

  // Esc ends Customize, unless a menu or dialog is open to close first.
  useEffect(() => {
    if (!editing) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || overlayOpen()) return;
      setEditing(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [editing]);

  // A widget just added is scrolled to and lit for a moment.
  useEffect(() => {
    if (!fresh) return;
    grid.current
      ?.querySelector(`[data-widget-id="${CSS.escape(fresh)}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = setTimeout(() => setFresh(null), 1800);
    return () => clearTimeout(timer);
  }, [fresh]);

  function remove(id: string) {
    const at = layout.findIndex((x) => x.id === id);
    const gone = layout[at];
    if (!gone) return;
    const before = layout;
    setLayout((l) => arrange(l.filter((x) => x.id !== id)));
    toast({
      title: `Removed ${titles?.[gone.id] ?? meta.get(gone.type)?.title ?? "the widget"}`,
      action: {
        label: "Undo",
        // Back exactly as it was, sizes included (closing up the rows may have changed some).
        run: () => setLayout((l) => (l.some((x) => x.id === id) ? l : before)),
      },
    });
  }

  function reset() {
    const before = layout;
    // The toast comes once it's done, so its Undo has what it needs.
    persist(null, (result) =>
      toast({
        title: resetLabel,
        action: {
          label: "Undo",
          run: async () => {
            if (!result.undo) {
              setLayout(before);
              saved.current = "";
              return;
            }
            const back = await result.undo();
            if (!back.ok) return back.error ?? "Couldn't put it back. Try again.";
            take(back.layout ?? before);
            if (refreshOnSave) router.refresh();
          },
        },
      }),
    );
  }

  // Unchanged is the same array, so a resize that hasn't crossed into the
  // next cell renders nothing.
  const patch = (id: string, change: { w: number; h: number | null }) =>
    setLayout((l) => {
      const at = l.findIndex((w) => w.id === id);
      const was = l[at];
      if (!was || (was.w === change.w && was.h === change.h)) return l;
      const next = [...l];
      next[at] = { ...was, ...change };
      return next;
    });

  function nudge(id: string, by: number) {
    setLayout((l) => {
      const i = l.findIndex((w) => w.id === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= l.length) return l;
      return arrayMove(l, i, j);
    });
  }

  // The others make way as you drag: the widget takes the place of the one
  // under the pointer. Once two have swapped, they don't swap back until the
  // pointer has left that one (a big widget would otherwise flicker).
  function onDragOver({ active, over }: DragOverEvent) {
    const target = over ? String(over.id) : null;
    if (!target || target === active.id) {
      lastSwap.current = null;
      return;
    }
    if (target === lastSwap.current) return;
    lastSwap.current = target;
    setLayout((l) => {
      const from = l.findIndex((w) => w.id === active.id);
      const to = l.findIndex((w) => w.id === target);
      return from < 0 || to < 0 ? l : arrayMove(l, from, to);
    });
  }

  /** The grid's columns right now, and how far apart they are (a row is the same). */
  function measure() {
    const el = grid.current;
    if (!el) return null;
    const style = getComputedStyle(el);
    const cols = style.gridTemplateColumns.split(" ").filter(Boolean).length || 1;
    const gap = parseFloat(style.columnGap) || 0;
    const col = (el.clientWidth - gap * (cols - 1)) / cols;
    return { cols, gap, pitch: col + gap, left: el.getBoundingClientRect().left };
  }

  const add = (type: string) => {
    const m = meta.get(type);
    if (!m) return;
    const id = newWidgetId(type, layout);
    setLayout(arrange([...layout, { id, type, w: m.w, h: m.h }]));
    setAdding(false);
    setFresh(id);
  };

  /** Ambient or Custom. Custom shows the member's own board; Edit arranges it. */
  function switchMode(next: BoardMode) {
    if (!ambient || next === mode) return;
    const was = mode;
    setMode(next);
    setEditing(false);
    setError(null);
    start(async () => {
      const result = await ambient.onMode(next);
      if (result.ok) {
        // Some widgets draw differently in Ambient (Here now with only you in).
        router.refresh();
        return;
      }
      setMode(was);
      setEditing(false);
      setError(result.error ?? "Couldn't switch the layout. Try again.");
    });
  }
  const bands =
    ambient && mode === "ambient"
      ? ambientLayout(
          [
            ...layout,
            ...(ambient.extras ?? []).filter((x) => !layout.some((w) => w.type === x.type)),
          ],
          {
            resting: new Set(ambient.resting),
            compact: new Set(ambient.compact),
            promoted: new Set(ambient.promoted ?? []),
            // Packed: widgets keep their own widths and slot in under each other.
            fill: false,
            scores: new Map(Object.entries(scores ?? {})),
            night: ambient.night,
          },
        )
      : null;

  // Ambient packs its widgets (no holes); measured again whenever the arrangement changes.
  usePacked(
    packed,
    bands
      ? bands.rows.map((r) => r.items.map((i) => `${i.widget.id}:${i.span}`).join()).join("|")
      : null,
  );

  const body = (w: BoardWidget) =>
    (bodies ? (bodies[w.id] ?? bodies[w.type]) : renderBody?.(w.type)) ?? null;
  const dragged = dragId ? layout.find((w) => w.id === dragId) : undefined;
  const draggedMeta = dragged ? meta.get(dragged.type) : undefined;

  return (
    <div className="space-y-[18px]">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">{intro}</div>
          <InBar>
            {/* + stays put; Customize becomes Reset and Done (a check) while on. */}
            <div className={cn("flex items-center gap-2 max-md:hidden", readOnly && "hidden")}>
              {!(ambient && mode === "ambient") && (
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label="Add a widget"
                  title="Add a widget"
                  disabled={layout.length >= MAX_WIDGETS}
                  onClick={() => setAdding(true)}
                >
                  <Plus className="size-4" aria-hidden="true" />
                </Button>
              )}
              {editing ? (
                <>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    aria-label={resetLabel}
                    title={resetLabel}
                    disabled={pending || !customized}
                    onClick={reset}
                  >
                    <RotateCcw className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    aria-label={ambient ? "Done editing" : "Done customizing"}
                    title="Done"
                    onClick={() => setEditing(false)}
                  >
                    <Check className="size-4" aria-hidden="true" />
                  </Button>
                </>
              ) : ambient ? (
                mode === "custom" && (
                  <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                    <Pencil className="size-4" aria-hidden="true" />
                    Edit
                  </Button>
                )
              ) : (
                <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                  <SlidersHorizontal className="size-4" aria-hidden="true" />
                  Customize
                </Button>
              )}
              {ambient && <ModeSwitch mode={mode} disabled={pending} onChange={switchMode} />}
            </div>
          </InBar>
        </div>
        {introDescription && (
          <p className="text-muted-foreground text-[15px]">{introDescription}</p>
        )}
      </div>
      {belowIntro && <div className="pt-2 pb-3">{belowIntro}</div>}

      {editing && (
        <p className="bg-muted/60 text-muted-foreground rounded-tile flex flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2.5 text-[13px] max-md:hidden">
          <span className="text-foreground font-semibold">{editHint}</span>
          <span>Drag a widget to move it.</span>
          <span>Drag its corner, or pick a shape, to resize it.</span>
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="bg-tint-danger text-tint-danger-foreground rounded-tile px-3 py-2 text-sm"
        >
          {error}
        </p>
      )}

      {notice}

      {(bands ? bands.rows.length === 0 && bands.resting.length === 0 : layout.length === 0) ? (
        <div className="text-muted-foreground rounded-block border-border flex flex-col items-center gap-3 border-[1.5px] border-dashed p-10 text-sm">
          <span className="bg-muted grid size-14 place-items-center rounded-full">
            <LayoutGrid className="size-6" aria-hidden="true" />
          </span>
          {noun[0].toUpperCase() + noun.slice(1)} has no widgets yet.
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Add a widget
          </Button>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={collision}
          onDragStart={({ active }) => {
            beforeDrag.current = layout;
            lastSwap.current = null;
            setDragId(String(active.id));
          }}
          onDragOver={onDragOver}
          onDragEnd={() => setDragId(null)}
          onDragCancel={() => {
            if (beforeDrag.current) setLayout(beforeDrag.current);
            setDragId(null);
          }}
        >
          <SortableContext items={layout.map((w) => w.id)} strategy={() => null}>
            <div className="@container">
              {bands ? (
                <div className="flex flex-col gap-4.5">
                  <div ref={packed} className={cn(PACKED_GRID, "relative")}>
                    {bands.rows.flatMap((row) =>
                      row.items.map((item, index) => {
                        const m = meta.get(item.widget.type);
                        const n = row.items.length;
                        if (!m) return null;
                        return (
                          <BoardItem
                            key={item.widget.id}
                            widget={item.widget}
                            meta={m}
                            readOnly
                            editing={false}
                            dragging={false}
                            fresh={fresh === item.widget.id}
                            hiddenOnPhone={hiddenOnPhone.includes(item.widget.type)}
                            actions={
                              headerActions?.[item.widget.id] ?? headerActions?.[item.widget.type]
                            }
                            measure={measure}
                            onShape={() => {}}
                            onNudge={() => {}}
                            onRemove={() => remove(item.widget.id)}
                            band={{
                              name: row.band,
                              span: item.span,
                              square: row.band === "now",
                              compact: item.compact,
                              lead: item.lead,
                              full:
                                row.band !== "now" || n === 1 || (n % 2 === 1 && index === n - 1),
                            }}
                          >
                            {body(item.widget)}
                          </BoardItem>
                        );
                      }),
                    )}
                  </div>
                  {/* Only what's on their board: an extra Home added isn't theirs to miss. */}
                  {bands.resting.some((w) => layout.some((l) => l.id === w.id)) && (
                    <RestingLine
                      night={ambient?.night}
                      titles={bands.resting
                        .filter((w) => layout.some((l) => l.id === w.id))
                        .map((w) => meta.get(w.type)?.title ?? w.type)}
                    />
                  )}
                </div>
              ) : (
                <div ref={grid} className={cn(GRID, "relative")}>
                  {layout.map((w) => {
                    const known = meta.get(w.type);
                    if (!known) return null;
                    const m = titles?.[w.id] ? { ...known, title: titles[w.id] } : known;
                    return (
                      <BoardItem
                        key={w.id}
                        widget={w}
                        meta={m}
                        readOnly={readOnly}
                        editing={editing}
                        dragging={dragId === w.id}
                        fresh={fresh === w.id}
                        hiddenOnPhone={hiddenOnPhone.includes(w.type)}
                        actions={
                          !editing ? (headerActions?.[w.id] ?? headerActions?.[w.type]) : null
                        }
                        measure={measure}
                        onShape={(nw, nh) => patch(w.id, { w: nw, h: nh })}
                        onNudge={(by) => nudge(w.id, by)}
                        onRemove={() => remove(w.id)}
                      >
                        {body(w)}
                      </BoardItem>
                    );
                  })}
                </div>
              )}
            </div>
          </SortableContext>
          {/* On the body: the page's own transforms would put a fixed overlay off. */}
          {browser &&
            createPortal(
              <DragOverlay
                dropAnimation={{ duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }}
              >
                {dragged && draggedMeta ? (
                  <div className="bg-card text-card-foreground ring-foreground/10 rounded-card shadow-e2 flex h-full cursor-grabbing flex-col gap-2 p-5 ring-1">
                    <div className="flex items-center gap-2">
                      <GripVertical className="text-muted-foreground size-4" aria-hidden="true" />
                      <span className="heading text-[17px]">
                        {titles?.[dragged.id] ?? draggedMeta.title}
                      </span>
                    </div>
                    <span className="text-muted-foreground flex items-center gap-2 text-[13px]">
                      <ShapeIcon w={dragged.w} h={dragged.h} />
                      {shapeName(dragged.w, dragged.h)}
                    </span>
                  </div>
                ) : null}
              </DragOverlay>,
              document.body,
            )}
        </DndContext>
      )}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-h-[85svh] overflow-y-auto overscroll-contain sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add a widget</DialogTitle>
            <DialogDescription className="sr-only">It goes at the end of {noun}.</DialogDescription>
          </DialogHeader>
          {layout.length >= MAX_WIDGETS ? (
            <p className="text-muted-foreground text-sm">
              {noun[0].toUpperCase() + noun.slice(1)} is full ({MAX_WIDGETS} widgets). Remove one
              first.
            </p>
          ) : (
            <div className="space-y-5">
              {groups.map((group) => (
                <section key={group} className="space-y-2">
                  <h3 className="text-muted-foreground text-[13px] font-semibold">{group}</h3>
                  <ul className="grid gap-2.5 sm:grid-cols-2">
                    {types
                      .filter((t) => t.group === group)
                      .map((t) => {
                        const Icon = BOARD_ICONS[t.icon] ?? ChartColumn;
                        const onBoard = layout.some((w) => w.type === t.type);
                        return (
                          <li key={t.type}>
                            <button
                              type="button"
                              onClick={() => add(t.type)}
                              className="bg-muted/50 hover:bg-muted focus-glow rounded-tile flex h-full w-full items-start gap-3 p-3 text-left transition-colors outline-none"
                            >
                              <IconChip icon={Icon} />
                              <span className="min-w-0">
                                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                                  {t.title}
                                  {onBoard && <Badge variant="secondary">Already added</Badge>}
                                </span>
                                <span className="text-muted-foreground block text-xs">
                                  {t.description}
                                </span>
                                <span className="text-muted-foreground mt-1.5 flex items-center gap-1.5 text-xs">
                                  <ShapeIcon w={t.w} h={t.h} />
                                  {shapeName(t.w, t.h)}
                                </span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
      {footer}
    </div>
  );
}

/** One widget on the board: its card, and while customizing its handle, shape and corner. */
function BoardItem({
  widget: w,
  meta: m,
  editing,
  readOnly,
  dragging,
  fresh,
  hiddenOnPhone,
  actions,
  measure,
  onShape,
  onNudge,
  onRemove,
  band,
  children,
}: {
  widget: BoardWidget;
  meta: WidgetMeta;
  editing: boolean;
  readOnly: boolean;
  dragging: boolean;
  fresh: boolean;
  hiddenOnPhone: boolean;
  actions: ReactNode;
  measure: () => { cols: number; gap: number; pitch: number; left: number } | null;
  onShape: (w: number, h: number | null) => void;
  onNudge: (by: number) => void;
  onRemove: () => void;
  /**
   * Laid out by Ambient: its columns of the band, whether it's in Now (two
   * across until the widest screens), and whether it takes both columns on
   * a tablet.
   */
  band?: {
    /** Which band it's in ("you", "now"...), on the element as data-band. */
    name: string;
    span: number;
    square: boolean;
    compact: boolean;
    full: boolean;
    lead?: string;
  };
  children: ReactNode;
}) {
  const { setNodeRef, listeners } = useSortable({ id: w.id, disabled: !editing });
  const coarse = useCoarsePointer();
  const drag = editing
    ? (listeners?.onPointerDown as React.PointerEventHandler | undefined)
    : undefined;
  const [resizing, setResizing] = useState(false);
  const bare = m.frame === "bare";

  // The corner follows the pointer a cell at a time: half way into the next
  // column or row takes it. Everything is measured from where the widget
  // was when the drag began, so a widget that moves (a wider one wrapping
  // to the next row) can't feed back into its own size. It widens only up
  // to the board's right edge from the column it's in; past that edge it
  // goes full width. A narrower screen's two columns read as half and full
  // width, so a widget wider than half stays as wide as it was. Moves are
  // taken once a frame.
  function startResize(e: React.PointerEvent<HTMLSpanElement>) {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    const card = handle.closest<HTMLElement>("[data-widget-id]");
    const grid = measure();
    if (!card || !grid) return;
    handle.setPointerCapture(e.pointerId);
    setResizing(true);
    const start = card.getBoundingClientRect();
    const column = Math.max(0, Math.round((start.left - grid.left) / grid.pitch));
    const room = Math.max(1, grid.cols - column);
    const edge = grid.left + grid.cols * grid.pitch - grid.gap;
    let frame = 0;
    let last: PointerEvent | null = null;
    const apply = () => {
      frame = 0;
      if (!last) return;
      const across = Math.round((last.clientX - start.left + grid.gap) / grid.pitch);
      const down = Math.round((last.clientY - start.top + grid.gap) / grid.pitch);
      const pastEdge = last.clientX > edge + grid.pitch / 3;
      const cols = pastEdge ? grid.cols : Math.min(room, Math.max(1, across));
      const nw =
        grid.cols >= BOARD_COLUMNS ? cols : cols >= grid.cols ? Math.max(w.w, grid.cols) : cols;
      onShape(nw, Math.min(MAX_ROWS, Math.max(1, down)));
    };
    const move = (ev: PointerEvent) => {
      last = ev;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const end = () => {
      if (frame) cancelAnimationFrame(frame);
      apply();
      setResizing(false);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  return (
    <section
      ref={setNodeRef}
      id={`w-${w.id}`}
      aria-label={m.title}
      data-widget-id={w.id}
      data-band={band?.name}
      data-wide={band && !band.square && band.span >= 6 ? "" : undefined}
      data-frame={bare ? "bare" : "card"}
      onPointerDown={coarse ? undefined : drag}
      style={!band && w.h ? ({ "--rows": w.h } as React.CSSProperties) : undefined}
      className={cn(
        band ? bandSpan(band) : (SPAN[w.w] ?? SPAN[1]),
        hiddenOnPhone && "max-md:hidden",
        "group/widget relative flex min-w-0 flex-col transition-[opacity,outline-color,box-shadow]",
        bare
          ? "rounded-block"
          : "bg-card text-card-foreground ring-foreground/6 edge rounded-card ring-1",
        // Packed Ambient shows every widget whole: nothing beside it needs evening up.
        band ? null : w.h ? ROWS_TALL : !bare && w.w < BOARD_COLUMNS && "lg:max-h-[30rem]",
        editing &&
          "outline-border cursor-grab outline-[1.5px] outline-offset-[3px] outline-dashed select-none active:cursor-grabbing",
        editing && !coarse && "touch-none",
        editing && bare && "bg-muted/40 p-2",
        editing && resizing && "outline-foreground outline-solid",
        dragging && "bg-muted/50 outline-foreground opacity-50",
        fresh && "ring-foreground/40 ring-2",
      )}
    >
      {!editing && !readOnly && (
        <button
          type="button"
          aria-label={`Remove ${m.title}`}
          onClick={onRemove}
          className="bg-card text-muted-foreground hover:text-destructive ring-foreground/10 focus-glow absolute -top-2.5 -right-2.5 z-10 grid size-7 place-items-center rounded-full opacity-0 shadow-sm ring-1 transition-opacity outline-none group-focus-within/widget:opacity-100 group-hover/widget:opacity-100 focus-visible:opacity-100 max-md:hidden"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      )}
      {/* A bare widget has no header until Customize: its body is its own surface. */}
      <header
        className={cn(
          "flex items-center gap-2",
          bare
            ? editing
              ? "mb-2 min-h-10 px-2"
              : "sr-only"
            : "min-h-14 px-[18px] pt-4 pb-1 sm:px-6 sm:pt-5",
          !editing && "flex-wrap",
        )}
      >
        {editing && (
          <span
            tabIndex={0}
            role="button"
            onPointerDown={coarse ? drag : undefined}
            aria-label={`Move ${m.title}. Arrow keys move it earlier or later.`}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                onNudge(-1);
              } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                onNudge(1);
              }
            }}
            className={cn(
              "text-muted-foreground hover:text-foreground hover:bg-muted focus-glow -ml-2 grid size-8 shrink-0 place-items-center rounded-full outline-none",
              coarse && "size-10 touch-none",
            )}
          >
            <GripVertical className="size-4" aria-hidden="true" />
          </span>
        )}
        <h2 className={cn("heading min-w-0 text-[17px] break-words", editing && "truncate")}>
          {m.title}
        </h2>
        {band?.lead && <AmbientWhy className="text-[12.5px]">{band.lead}</AmbientWhy>}
        {actions && <div className="flex min-w-0 flex-1 items-center gap-1.5">{actions}</div>}
        {editing && (
          // Pressing a control here is a click, not the start of a drag.
          <div
            className="ms-auto flex shrink-0 items-center gap-1"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <ShapePicker title={m.title} w={w.w} h={w.h} compact={w.w === 1} onChange={onShape} />
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              className="text-muted-foreground hover:text-destructive"
              aria-label={`Remove ${m.title}`}
              onClick={onRemove}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
        )}
      </header>
      <div
        inert={editing || undefined}
        className={cn(
          "min-h-0 flex-1",
          bare
            ? "flex flex-col"
            : // The page keeps scrolling past a widget: a long one scrolls inside, then hands
              // the wheel back to the page (no overscroll-contain, which trapped it there).
              "overflow-auto rounded-b-[inherit] px-[18px] pt-3 pb-5 sm:px-6 sm:pb-6",
          editing && "opacity-70",
        )}
      >
        {children}
      </div>
      {editing && resizing && (
        <span className="bg-foreground text-background shadow-e2 pointer-events-none absolute top-1/2 left-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-semibold whitespace-nowrap">
          <ShapeIcon w={w.w} h={w.h} />
          {shapeName(w.w, w.h)}
        </span>
      )}
      {editing && (
        <span
          role="presentation"
          title="Drag to resize"
          onPointerDown={startResize}
          className="group/corner absolute -right-1.5 -bottom-1.5 z-10 grid size-7 cursor-nwse-resize touch-none place-items-center max-sm:hidden"
        >
          <span className="bg-card ring-foreground/15 group-hover/corner:bg-foreground group-hover/corner:text-background text-muted-foreground grid size-5 place-items-center rounded-full shadow-sm ring-1 transition-colors">
            <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden="true">
              <path
                d="M9 3 3 9M9 6.5 6.5 9"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </span>
        </span>
      )}
    </section>
  );
}

/** The widgets resting in Ambient, named in one quiet line so they read as resting, not lost. */
function RestingLine({ titles, night }: { titles: string[]; night?: boolean }) {
  const list =
    titles.length === 1
      ? titles[0]
      : `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}`;
  return (
    <p className="text-muted-foreground rounded-tile ring-border flex items-center gap-2.5 px-4 py-3 text-[13px] ring-1 ring-inset">
      <Eye className="size-4 shrink-0" aria-hidden="true" />
      <span>
        {night
          ? `${list} ${titles.length === 1 ? "rests" : "rest"} until morning.`
          : `${list} ${titles.length === 1 ? "is" : "are"} resting until there's something new to show.`}
      </span>
    </p>
  );
}

/** Ambient or Custom, as one two-way switch. */
function ModeSwitch({
  mode,
  disabled,
  onChange,
}: {
  mode: BoardMode;
  disabled: boolean;
  onChange: (mode: BoardMode) => void;
}) {
  const options = [
    { value: "ambient" as const, label: "Ambient", Icon: Sunrise, hint: "Home arranges itself" },
    {
      value: "custom" as const,
      label: "Custom",
      Icon: SlidersHorizontal,
      hint: "Arrange it yourself",
    },
  ];
  // One tab stop; the arrow keys move between the two, as a radio group does.
  // While a switch is saving, clicks are ignored rather than the buttons
  // greyed out, so focus stays put.
  const pick = (value: BoardMode) => {
    if (!disabled) onChange(value);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const next = mode === "ambient" ? "custom" : "ambient";
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-mode="${next}"]`)?.focus();
    pick(next);
  };
  return (
    <div
      role="radiogroup"
      aria-label="Layout"
      aria-busy={disabled || undefined}
      onKeyDown={onKeyDown}
      className="bg-card ring-border inline-flex h-9 items-center rounded-full p-[3px] ring-1 ring-inset"
    >
      {options.map(({ value, label, Icon, hint }) => {
        const on = mode === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            data-mode={value}
            title={hint}
            onClick={() => pick(value)}
            className={cn(
              "focus-glow inline-flex h-full items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition-colors outline-none",
              on ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
