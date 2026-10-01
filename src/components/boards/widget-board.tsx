"use client";

import {
  ArrowLeftRight,
  CalendarDays,
  CalendarRange,
  ChartBar,
  ChartColumn,
  ChartLine,
  ChartPie,
  Check,
  CheckSquare,
  Clock,
  FolderOpen,
  GripVertical,
  HandCoins,
  Handshake,
  Hourglass,
  LayoutGrid,
  Link2,
  ListChecks,
  Loader2,
  NotebookText,
  PiggyBank,
  Pin,
  Plus,
  ReceiptText,
  Rocket,
  RotateCcw,
  Target,
  Timer,
  TrendingDown,
  Users,
  Vote,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BOARD_COLUMNS,
  clampHeight,
  clampWidth,
  HEIGHT_PRESETS,
  MAX_WIDGETS,
  newWidgetId,
  type BoardWidget,
  type WidgetMeta,
} from "@/lib/boards";
import { cn } from "@/lib/utils";

export const BOARD_ICONS: Record<string, LucideIcon> = {
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
  Timer,
  TrendingDown,
  Users,
  Vote,
  Wallet,
};

const SPAN: Record<number, string> = {
  1: "col-span-1",
  2: "col-span-1 sm:col-span-2",
  3: "col-span-1 sm:col-span-2 lg:col-span-3",
  4: "col-span-1 sm:col-span-2 lg:col-span-4",
};

const WIDTH_LABEL: Record<number, string> = { 1: "¼", 2: "½", 3: "¾", 4: "Full" };

export type SaveBoard = (layout: BoardWidget[] | null) => Promise<{ ok: boolean; error?: string }>;

/**
 * A member's own board of widgets. Customize to: add widgets from a gallery,
 * drag them by the handle to reorder, drag the corner to resize (width snaps
 * to columns, height to 20px), or use the width and height buttons; remove,
 * reset, and Done to save. Only the member's own board changes.
 */
export function WidgetBoard({
  types,
  initialLayout,
  customized,
  bodies,
  renderBody,
  onSave,
  intro,
}: {
  types: readonly WidgetMeta[];
  initialLayout: BoardWidget[];
  customized: boolean;
  /** Pre-rendered widget bodies by type (from a server component). */
  bodies?: Readonly<Record<string, ReactNode>>;
  /** Or a render function (from a client wrapper). */
  renderBody?: (type: string) => ReactNode;
  onSave: SaveBoard;
  /** What the toolbar says when not editing. */
  intro?: ReactNode;
}) {
  const router = useRouter();
  const [layout, setLayout] = useState(initialLayout);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const meta = new Map(types.map((t) => [t.type, t]));
  const groups = [...new Set(types.map((t) => t.group))];

  function persist(next: BoardWidget[] | null) {
    setError(null);
    start(async () => {
      const result = await onSave(next);
      if (!result.ok) {
        setError(result.error ?? "That layout couldn't be saved.");
        return;
      }
      if (next === null) setLayout(initialLayout);
      setEditing(false);
      router.refresh();
    });
  }

  const patch = (id: string, change: Partial<BoardWidget>) =>
    setLayout((l) => l.map((w) => (w.id === id ? { ...w, ...change } : w)));

  function moveBefore(sourceId: string, targetId: string | null) {
    setLayout((l) => {
      const source = l.find((w) => w.id === sourceId);
      if (!source || sourceId === targetId) return l;
      const rest = l.filter((w) => w.id !== sourceId);
      const at = targetId ? rest.findIndex((w) => w.id === targetId) : rest.length;
      return [...rest.slice(0, at < 0 ? rest.length : at), source, ...rest.slice(at < 0 ? rest.length : at)];
    });
  }

  function nudge(id: string, by: number) {
    setLayout((l) => {
      const i = l.findIndex((w) => w.id === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= l.length) return l;
      const next = [...l];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  /** Corner drag: width in whole columns, height in 20px steps. */
  function startResize(e: React.PointerEvent, widget: BoardWidget, card: HTMLElement) {
    e.preventDefault();
    const gridEl = grid.current;
    if (!gridEl) return;
    const cols = getComputedStyle(gridEl).gridTemplateColumns.split(" ").length || BOARD_COLUMNS;
    const gap = parseFloat(getComputedStyle(gridEl).columnGap) || 16;
    const colWidth = (gridEl.clientWidth - gap * (cols - 1)) / cols;
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = card.getBoundingClientRect().width;
    const startH = card.getBoundingClientRect().height;
    const move = (ev: PointerEvent) => {
      const w = clampWidth(Math.min(cols, (startW + ev.clientX - startX + gap) / (colWidth + gap)));
      const h = clampHeight(startH + ev.clientY - startY);
      patch(widget.id, { w: cols < BOARD_COLUMNS && w >= cols ? Math.max(widget.w, w) : w, h });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const add = (type: string) => {
    const m = meta.get(type);
    if (!m) return;
    setLayout((l) => [...l, { id: newWidgetId(type, l), type, w: m.w, h: m.h }]);
    setAdding(false);
    setEditing(true);
  };

  const body = (type: string) => (bodies ? bodies[type] : renderBody?.(type)) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-muted-foreground min-w-0 text-sm">
          {editing ? "Drag to reorder, drag a corner to resize. Only you see these changes." : intro}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
                <Plus className="size-4" aria-hidden="true" />
                Add widget
              </Button>
              {customized && (
                <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => persist(null)}>
                  <RotateCcw className="size-4" aria-hidden="true" />
                  Reset
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setLayout(initialLayout);
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
              <Button type="button" size="sm" disabled={pending} onClick={() => persist(layout)}>
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Check className="size-4" aria-hidden="true" />
                )}
                Done
              </Button>
            </>
          ) : (
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
              <LayoutGrid className="size-4" aria-hidden="true" />
              Customize
            </Button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      {layout.length === 0 ? (
        <button
          type="button"
          onClick={() => {
            setEditing(true);
            setAdding(true);
          }}
          className="text-muted-foreground hover:bg-muted/40 hover:text-foreground flex w-full flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-sm"
        >
          <Plus className="size-5" aria-hidden="true" />
          Your board is empty. Add a widget.
        </button>
      ) : (
        <div
          ref={grid}
          className="grid grid-flow-row-dense grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
          onDragOver={(e) => {
            if (dragId) e.preventDefault();
          }}
          onDrop={(e) => {
            if (!dragId) return;
            e.preventDefault();
            if (!overId) moveBefore(dragId, null);
            setDragId(null);
            setOverId(null);
          }}
        >
          {layout.map((w) => {
            const m = meta.get(w.type);
            if (!m) return null;
            const Icon = BOARD_ICONS[m.icon] ?? ChartColumn;
            return (
              <section
                key={w.id}
                aria-label={m.title}
                data-dragging={dragId === w.id || undefined}
                className={cn(
                  SPAN[w.w] ?? SPAN[1],
                  "bg-card text-card-foreground relative flex min-w-0 flex-col overflow-hidden rounded-xl border shadow-xs transition-shadow",
                  editing && "ring-primary/25 ring-2",
                  dragId === w.id && "opacity-40",
                  overId === w.id && dragId !== w.id && "ring-primary ring-2",
                )}
                style={w.h ? { height: w.h } : undefined}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setOverId(w.id);
                }}
                onDrop={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  e.stopPropagation();
                  moveBefore(dragId, w.id);
                  setDragId(null);
                  setOverId(null);
                }}
              >
                <header className="flex items-center gap-2 px-4 pt-3.5 pb-2">
                  {editing && (
                    <span
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", w.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragId(w.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverId(null);
                      }}
                      tabIndex={0}
                      role="button"
                      aria-label={`Move ${m.title}. Arrow keys move it earlier or later.`}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                          e.preventDefault();
                          nudge(w.id, -1);
                        } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                          e.preventDefault();
                          nudge(w.id, 1);
                        }
                      }}
                      className="text-muted-foreground hover:text-foreground -ml-1 cursor-grab rounded p-0.5 active:cursor-grabbing"
                    >
                      <GripVertical className="size-4" aria-hidden="true" />
                    </span>
                  )}
                  <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                  <h2 className="min-w-0 truncate text-sm font-medium">{m.title}</h2>
                  {editing && (
                    <div className="ms-auto flex shrink-0 items-center gap-1">
                      <div className="bg-muted flex rounded-md p-0.5" role="group" aria-label={`${m.title} width`}>
                        {[1, 2, 3, 4].map((n) => (
                          <button
                            key={n}
                            type="button"
                            aria-pressed={w.w === n}
                            title={`${n} of ${BOARD_COLUMNS} columns`}
                            onClick={() => patch(w.id, { w: n })}
                            className={cn(
                              "min-w-6 rounded px-1 text-[11px] font-medium",
                              w.w === n ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {WIDTH_LABEL[n]}
                          </button>
                        ))}
                      </div>
                      <div className="bg-muted hidden rounded-md p-0.5 sm:flex" role="group" aria-label={`${m.title} height`}>
                        {HEIGHT_PRESETS.map((p) => (
                          <button
                            key={p.label}
                            type="button"
                            aria-pressed={w.h === p.value}
                            onClick={() => patch(w.id, { h: p.value })}
                            className={cn(
                              "min-w-6 rounded px-1 text-[11px] font-medium",
                              w.h === p.value ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="text-destructive size-7"
                        aria-label={`Remove ${m.title}`}
                        onClick={() => setLayout((l) => l.filter((x) => x.id !== w.id))}
                      >
                        <X className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  )}
                </header>
                <div className={cn("min-h-0 flex-1 px-4 pb-4", w.h && "overflow-auto")}>{body(w.type)}</div>
                {editing && (
                  <span
                    aria-hidden="true"
                    title="Drag to resize"
                    onPointerDown={(e) => startResize(e, w, e.currentTarget.parentElement as HTMLElement)}
                    className="bg-primary/15 hover:bg-primary/30 absolute right-0 bottom-0 size-5 cursor-nwse-resize rounded-tl-md"
                    style={{ clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}
                  />
                )}
              </section>
            );
          })}
        </div>
      )}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add a widget</DialogTitle>
            <DialogDescription>
              Pick what you want on your board. Add the same one twice, then drag and resize it
              however you like.
            </DialogDescription>
          </DialogHeader>
          {layout.length >= MAX_WIDGETS ? (
            <p className="text-muted-foreground text-sm">Your board is full ({MAX_WIDGETS} widgets). Remove one first.</p>
          ) : (
            <div className="space-y-5">
              {groups.map((group) => (
                <section key={group} className="space-y-2">
                  <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{group}</h3>
                  <ul className="grid gap-2 sm:grid-cols-2">
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
                              className="hover:bg-accent/60 hover:border-foreground/15 flex h-full w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors"
                            >
                              <span className="bg-primary/10 text-primary grid size-8 shrink-0 place-items-center rounded-md">
                                <Icon className="size-4" aria-hidden="true" />
                              </span>
                              <span className="min-w-0">
                                <span className="flex items-center gap-2 text-sm font-medium">
                                  {t.title}
                                  {onBoard && (
                                    <span className="text-muted-foreground text-[11px] font-normal">on your board</span>
                                  )}
                                </span>
                                <span className="text-muted-foreground block text-xs">{t.description}</span>
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
    </div>
  );
}
