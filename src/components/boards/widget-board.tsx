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
  ArrowLeftRight,
  CalendarDays,
  CalendarRange,
  ChartBar,
  ChartColumn,
  ChartLine,
  ChartPie,
  CheckSquare,
  Clock,
  FolderOpen,
  GripVertical,
  HandCoins,
  Handshake,
  LayoutGrid,
  Hourglass,
  Link2,
  ListChecks,
  NotebookText,
  PiggyBank,
  Pin,
  Plus,
  ReceiptText,
  Rocket,
  RotateCcw,
  SlidersHorizontal,
  Target,
  Ticket,
  Timer,
  TrendingDown,
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
  newWidgetId,
  shapeName,
  type BoardWidget,
  type WidgetMeta,
} from "@/lib/boards";
import { overlayOpen } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

export const BOARD_ICONS: Record<string, IconComponent> = {
  Activity,
  ArrowLeftRight,
  CalendarDays,
  CalendarRange,
  ChartBar,
  ChartColumn,
  ChartLine,
  ChartPie,
  CheckSquare,
  Clock,
  FolderOpen,
  HandCoins,
  Handshake,
  Hourglass,
  Link2,
  ListChecks,
  NotebookText,
  PiggyBank,
  Pin,
  ReceiptText,
  Rocket,
  Target,
  Ticket,
  Timer,
  TrendingDown,
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
 * A row is as tall as a column is wide, so 1 by 1 is a square: the board is
 * a size container and --board-row is one column's width (the gap is 4.5,
 * 1.125rem). A widget with rows spans them and is exactly that tall.
 */
const GRID =
  "grid grid-cols-1 gap-4.5 sm:grid-cols-2 lg:grid-cols-4 sm:[--board-row:calc((100cqw_-_1.125rem)/2)] lg:[--board-row:calc((100cqw_-_3.375rem)/4)]";
const ROWS_TALL =
  "sm:h-[calc(var(--board-row)*var(--rows)_+_1.125rem*(var(--rows)_-_1))] sm:[grid-row:span_var(--rows)] max-sm:max-h-[30rem]";

/** The item under the pointer, or the nearest one when it's between them. */
const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : closestCenter(args);
};

const noSubscribe = () => () => {};

export type SaveBoard = (layout: BoardWidget[] | null) => Promise<{ ok: boolean; error?: string }>;

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
    const origin = el.getBoundingClientRect();
    const next = new Map<string, { x: number; y: number }>();
    for (const node of el.querySelectorAll<HTMLElement>("[data-widget-id]")) {
      const id = node.dataset.widgetId ?? "";
      const r = node.getBoundingClientRect();
      const spot = { x: r.left - origin.left, y: r.top - origin.top };
      next.set(id, spot);
      const was = spots.current.get(id);
      if (!was || still) continue;
      const dx = was.x - spot.x;
      const dy = was.y - spot.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
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
}) {
  const router = useRouter();
  const [layout, setLayout] = useState(initialLayout);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);
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

  function persist(next: BoardWidget[] | null) {
    setError(null);
    start(async () => {
      const result = await onSave(next);
      if (!result.ok) {
        setError(result.error ?? "That layout couldn't be saved.");
        return;
      }
      if (next === null) setLayout(initialLayout);
      router.refresh();
    });
  }

  // The board saves as you go: every change (a remove, an add, a drag) is
  // sent a moment after the last one, so there is no Save or Cancel.
  const saved = useRef(JSON.stringify(initialLayout));
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
    setLayout((l) => l.filter((x) => x.id !== id));
    toast({
      title: "Removed",
      action: {
        label: "Undo",
        run: () =>
          setLayout((l) =>
            l.some((x) => x.id === id) ? l : [...l.slice(0, at), gone, ...l.slice(at)],
          ),
      },
    });
  }

  function reset() {
    const before = layout;
    persist(null);
    toast({
      title: "Reset",
      action: {
        label: "Undo",
        run: () => {
          setLayout(before);
          saved.current = "";
        },
      },
    });
  }

  const patch = (id: string, change: Partial<BoardWidget>) =>
    setLayout((l) =>
      l.map((w) =>
        w.id === id && (change.w !== w.w || change.h !== w.h) ? { ...w, ...change } : w,
      ),
    );

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
    return { cols, gap, pitch: col + gap };
  }

  const add = (type: string) => {
    const m = meta.get(type);
    if (!m) return;
    const id = newWidgetId(type, layout);
    setLayout([...layout, { id, type, w: m.w, h: m.h }]);
    setAdding(false);
    setFresh(id);
  };

  const body = (type: string) => (bodies ? bodies[type] : renderBody?.(type)) ?? null;
  const dragged = dragId ? layout.find((w) => w.id === dragId) : undefined;
  const draggedMeta = dragged ? meta.get(dragged.type) : undefined;

  return (
    <div className="space-y-[18px]">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">{intro}</div>
          <InBar>
            <div className="flex items-center gap-2 max-md:hidden">
              {editing && customized && (
                <Button type="button" variant="ghost" disabled={pending} onClick={reset}>
                  <RotateCcw className="size-4" aria-hidden="true" />
                  Reset
                </Button>
              )}
              <Button
                type="button"
                variant={editing ? "default" : "outline"}
                aria-pressed={editing}
                onClick={() => setEditing((on) => !on)}
              >
                <SlidersHorizontal className="size-4" aria-hidden="true" />
                {editing ? "Done" : "Customize"}
              </Button>
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
          <span className="text-foreground font-semibold">Only you see your board.</span>
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

      {layout.length === 0 ? (
        <div className="text-muted-foreground rounded-block border-border flex flex-col items-center gap-3 border-[1.5px] border-dashed p-10 text-sm">
          <span className="bg-muted grid size-14 place-items-center rounded-full">
            <LayoutGrid className="size-6" aria-hidden="true" />
          </span>
          Your board is empty.
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
              <div ref={grid} className={GRID}>
                {layout.map((w) => {
                  const m = meta.get(w.type);
                  if (!m) return null;
                  return (
                    <BoardItem
                      key={w.id}
                      widget={w}
                      meta={m}
                      editing={editing}
                      dragging={dragId === w.id}
                      fresh={fresh === w.id}
                      hiddenOnPhone={hiddenOnPhone.includes(w.type)}
                      actions={!editing ? headerActions?.[w.type] : null}
                      measure={measure}
                      onShape={(nw, nh) => patch(w.id, { w: nw, h: nh })}
                      onNudge={(by) => nudge(w.id, by)}
                      onRemove={() => remove(w.id)}
                    >
                      {body(w.type)}
                    </BoardItem>
                  );
                })}
              </div>
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
                      <span className="heading text-[17px]">{draggedMeta.title}</span>
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
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add a widget</DialogTitle>
            <DialogDescription className="sr-only">
              It goes at the end of your board.
            </DialogDescription>
          </DialogHeader>
          {layout.length >= MAX_WIDGETS ? (
            <p className="text-muted-foreground text-sm">
              Your board is full ({MAX_WIDGETS} widgets). Remove one first.
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
                                  {onBoard && <Badge variant="secondary">On your board</Badge>}
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
  dragging,
  fresh,
  hiddenOnPhone,
  actions,
  measure,
  onShape,
  onNudge,
  onRemove,
  children,
}: {
  widget: BoardWidget;
  meta: WidgetMeta;
  editing: boolean;
  dragging: boolean;
  fresh: boolean;
  hiddenOnPhone: boolean;
  actions: ReactNode;
  measure: () => { cols: number; gap: number; pitch: number } | null;
  onShape: (w: number, h: number | null) => void;
  onNudge: (by: number) => void;
  onRemove: () => void;
  children: ReactNode;
}) {
  const { setNodeRef, listeners } = useSortable({ id: w.id, disabled: !editing });
  const [resizing, setResizing] = useState(false);
  const bare = m.frame === "bare";

  // The corner follows the pointer a cell at a time: half way into the next
  // column or row takes it. A narrower screen's two columns read as half and
  // full width, so a widget wider than half stays as wide as it was.
  function startResize(e: React.PointerEvent<HTMLSpanElement>) {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    const card = handle.closest<HTMLElement>("[data-widget-id]");
    const grid = measure();
    if (!card || !grid) return;
    handle.setPointerCapture(e.pointerId);
    setResizing(true);
    const top = card.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const across = Math.round((ev.clientX - top.left + grid.gap) / grid.pitch);
      const down = Math.round((ev.clientY - top.top + grid.gap) / grid.pitch);
      const cols = Math.min(grid.cols, Math.max(1, across));
      const nw = grid.cols >= BOARD_COLUMNS ? cols : cols >= grid.cols ? Math.max(w.w, cols) : cols;
      onShape(nw, Math.min(MAX_ROWS, Math.max(1, down)));
    };
    const end = () => {
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
      aria-label={m.title}
      data-widget-id={w.id}
      data-frame={bare ? "bare" : "card"}
      onPointerDown={
        editing ? (listeners?.onPointerDown as React.PointerEventHandler | undefined) : undefined
      }
      style={w.h ? ({ "--rows": w.h } as React.CSSProperties) : undefined}
      className={cn(
        SPAN[w.w] ?? SPAN[1],
        hiddenOnPhone && "max-md:hidden",
        "group/widget relative flex min-w-0 flex-col transition-[opacity,outline-color,box-shadow]",
        bare
          ? "rounded-block"
          : "bg-card text-card-foreground ring-foreground/6 edge rounded-card ring-1",
        w.h ? ROWS_TALL : !bare && w.w < BOARD_COLUMNS && "lg:max-h-[30rem]",
        editing &&
          "outline-border cursor-grab touch-none outline-[1.5px] outline-offset-[3px] outline-dashed select-none active:cursor-grabbing",
        editing && bare && "bg-muted/40 p-2",
        editing && resizing && "outline-foreground outline-solid",
        dragging && "bg-muted/50 outline-foreground opacity-50",
        fresh && "ring-foreground/40 ring-2",
      )}
    >
      {!editing && (
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
            className="text-muted-foreground hover:text-foreground hover:bg-muted focus-glow -ml-2 grid size-8 shrink-0 place-items-center rounded-full outline-none"
          >
            <GripVertical className="size-4" aria-hidden="true" />
          </span>
        )}
        <h2 className={cn("heading min-w-0 text-[17px] break-words", editing && "truncate")}>
          {m.title}
        </h2>
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
            : "overflow-auto rounded-b-[inherit] px-[18px] pt-3 pb-5 sm:px-6 sm:pb-6",
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
