"use client";

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
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toaster";
import { IconChip } from "@/components/ui/stat";
import {
  BOARD_COLUMNS,
  HEIGHT_PRESETS,
  MAX_WIDGETS,
  newWidgetId,
  type BoardWidget,
  type WidgetMeta,
} from "@/lib/boards";
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

const WIDTHS = [
  { value: "1", label: "¼" },
  { value: "2", label: "½" },
  { value: "3", label: "¾" },
  { value: "4", label: "Full" },
];

export type SaveBoard = (layout: BoardWidget[] | null) => Promise<{ ok: boolean; error?: string }>;

/**
 * A member's own board of widgets.
 *
 * Reading it is just the widgets, in the order the member put them: rows
 * line up (a widget that isn't full width stops growing at a set height and
 * scrolls inside), and nothing is packed out of order to fill a gap.
 *
 * Removing and adding need no mode: every widget has an x (on hover) that
 * takes it off with Undo, and a + at the end of the board adds one. Customize
 * is a switch for the rest: each widget gets a handle to drag it (arrow keys
 * move it too) and its width and height. Every change saves itself, so there
 * is no Done or Cancel. Only the member's own board changes.
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
  const [overId, setOverId] = useState<string | null>(null);
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
      router.refresh();
    });
  }

  // The board saves as you go: every change (a remove, an add, a drag) is
  // sent a moment after the last one, so there is no Save, Done or Cancel.
  const saved = useRef(JSON.stringify(initialLayout));
  useEffect(() => {
    const now = JSON.stringify(layout);
    if (now === saved.current) return;
    const timer = setTimeout(() => {
      saved.current = now;
      persist(layout);
    }, 600);
    return () => clearTimeout(timer);
    // persist is stable enough here: it only reads onSave and the router.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

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
    setLayout((l) => l.map((w) => (w.id === id ? { ...w, ...change } : w)));

  function moveBefore(sourceId: string, targetId: string | null) {
    setLayout((l) => {
      const source = l.find((w) => w.id === sourceId);
      if (!source || sourceId === targetId) return l;
      const rest = l.filter((w) => w.id !== sourceId);
      const at = targetId ? rest.findIndex((w) => w.id === targetId) : rest.length;
      return [
        ...rest.slice(0, at < 0 ? rest.length : at),
        source,
        ...rest.slice(at < 0 ? rest.length : at),
      ];
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

  const add = (type: string) => {
    const m = meta.get(type);
    if (!m) return;
    setLayout([...layout, { id: newWidgetId(type, layout), type, w: m.w, h: m.h }]);
    setAdding(false);
  };

  const body = (type: string) => (bodies ? bodies[type] : renderBody?.(type)) ?? null;

  return (
    <div className="space-y-[18px]">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">{intro}</div>
          <div className="flex items-center gap-2 max-md:hidden">
            {editing && <span className="text-muted-foreground text-sm">Only you see this.</span>}
            {editing && customized && (
              <Button type="button" variant="ghost" disabled={pending} onClick={reset}>
                <RotateCcw className="size-4" aria-hidden="true" />
                Reset
              </Button>
            )}
            <Button
              type="button"
              variant={editing ? "secondary" : "outline"}
              aria-pressed={editing}
              onClick={() => setEditing((on) => !on)}
            >
              <SlidersHorizontal className="size-4" aria-hidden="true" />
              Customize
            </Button>
          </div>
        </div>
        {introDescription && (
          <p className="text-muted-foreground text-[15px]">{introDescription}</p>
        )}
      </div>
      {belowIntro && <div className="pt-2 pb-3">{belowIntro}</div>}

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
        <div
          className="grid grid-cols-1 gap-4.5 sm:grid-cols-2 lg:grid-cols-4"
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
            const bare = m.frame === "bare";
            const actions = !editing ? headerActions?.[w.type] : null;
            return (
              <section
                key={w.id}
                aria-label={m.title}
                data-dragging={dragId === w.id || undefined}
                data-frame={bare ? "bare" : "card"}
                className={cn(
                  SPAN[w.w] ?? SPAN[1],
                  hiddenOnPhone.includes(w.type) && "max-md:hidden",
                  "group/widget relative flex min-w-0 flex-col transition-[opacity,outline-color]",
                  bare
                    ? "rounded-block"
                    : "bg-card text-card-foreground ring-foreground/6 edge rounded-card ring-1",
                  // Part-width widgets stop at a common height so rows line up.
                  !bare && !w.h && w.w < BOARD_COLUMNS && "lg:max-h-[30rem]",
                  editing && "outline-border outline-[1.5px] outline-offset-[3px] outline-dashed",
                  editing && bare && "bg-muted/40 p-2",
                  dragId === w.id && "opacity-40",
                  overId === w.id && dragId !== w.id && "outline-foreground outline-solid",
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
                {!editing && (
                  <button
                    type="button"
                    aria-label={`Remove ${m.title}`}
                    onClick={() => remove(w.id)}
                    className="bg-card text-muted-foreground hover:text-destructive ring-foreground/10 focus-glow absolute -top-2.5 -right-2.5 z-10 grid size-7 place-items-center rounded-full opacity-0 shadow-sm ring-1 transition-opacity outline-none group-focus-within/widget:opacity-100 group-hover/widget:opacity-100 focus-visible:opacity-100 max-md:hidden"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                )}
                {/* While editing, a narrow widget's controls wrap below its title. A
                    bare widget has no header until then: its body is its own surface. */}
                <header
                  className={cn(
                    "flex flex-wrap items-center gap-2",
                    bare
                      ? editing
                        ? "mb-2 min-h-10 px-2"
                        : "sr-only"
                      : "min-h-14 px-[18px] pt-4 pb-1 sm:px-6 sm:pt-5",
                  )}
                >
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
                      className="text-muted-foreground hover:text-foreground hover:bg-muted focus-glow -ml-2 grid size-8 cursor-grab place-items-center rounded-full outline-none active:cursor-grabbing"
                    >
                      <GripVertical className="size-4" aria-hidden="true" />
                    </span>
                  )}
                  <h2 className="heading min-w-0 text-[17px] break-words">{m.title}</h2>
                  {actions && (
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">{actions}</div>
                  )}
                  {editing && (
                    <div
                      className={cn(
                        "ms-auto flex min-w-0 flex-wrap items-center justify-end gap-1",
                        w.w === 1 && "lg:ms-0 lg:basis-full lg:justify-start",
                      )}
                    >
                      <Segmented
                        label={`${m.title} width`}
                        value={String(w.w)}
                        onSelect={(v) => patch(w.id, { w: Number(v) })}
                        options={WIDTHS}
                        className="hidden sm:inline-flex"
                      />
                      <Segmented
                        label={`${m.title} height`}
                        value={String(w.h ?? "fit")}
                        onSelect={(v) => patch(w.id, { h: v === "fit" ? null : Number(v) })}
                        options={HEIGHT_PRESETS.map((p) => ({
                          value: String(p.value ?? "fit"),
                          label: p.label,
                        }))}
                        className="hidden lg:inline-flex"
                      />
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Remove ${m.title}`}
                        onClick={() => remove(w.id)}
                      >
                        <X className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  )}
                </header>
                <div
                  className={cn(
                    "min-h-0 flex-1",
                    bare
                      ? "flex flex-col"
                      : "overflow-auto rounded-b-[inherit] px-[18px] pt-3 pb-5 sm:px-6 sm:pb-6",
                  )}
                >
                  {body(w.type)}
                </div>
              </section>
            );
          })}
          {layout.length < MAX_WIDGETS && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="group/add text-muted-foreground hover:text-foreground hover:bg-muted/40 border-border focus-glow rounded-card flex min-h-24 items-center justify-center gap-2.5 border-[1.5px] border-dashed text-sm font-semibold transition-colors outline-none max-md:hidden"
            >
              <span className="bg-muted group-hover/add:bg-foreground group-hover/add:text-background grid size-8 place-items-center rounded-full transition-colors">
                <Plus className="size-4" aria-hidden="true" />
              </span>
              Add a widget
            </button>
          )}
        </div>
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
