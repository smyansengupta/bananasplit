"use client";

import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Check,
  ChartBar,
  ChartColumn,
  ChartLine,
  ChartPie,
  HandCoins,
  Handshake,
  Hourglass,
  LayoutGrid,
  Loader2,
  PiggyBank,
  Plus,
  ReceiptText,
  RotateCcw,
  Target,
  Timer,
  TrendingDown,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { saveFinanceWidgetsAction } from "@/app/app/[orgSlug]/finance/widgets-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DashboardData } from "@/app/app/[orgSlug]/finance/queries";
import {
  MAX_WIDGETS,
  newWidgetId,
  WIDGET_GROUPS,
  WIDGET_SIZES,
  WIDGET_TYPES,
  widgetType,
  type Widget,
  type WidgetSize,
  type WidgetTypeId,
} from "@/lib/finance/widgets";
import { cn } from "@/lib/utils";

import { WidgetBody } from "./finance-widgets";

export const WIDGET_ICONS: Record<string, LucideIcon> = {
  Wallet,
  ArrowLeftRight,
  PiggyBank,
  HandCoins,
  Hourglass,
  ChartColumn,
  ChartLine,
  ChartPie,
  ChartBar,
  Target,
  Timer,
  Handshake,
  ReceiptText,
  TrendingDown,
};

const SPAN: Record<WidgetSize, string> = {
  sm: "col-span-1",
  md: "col-span-1 sm:col-span-2",
  lg: "col-span-1 sm:col-span-2 lg:col-span-4",
};

const SIZE_LABEL: Record<WidgetSize, string> = { sm: "Small", md: "Wide", lg: "Full width" };

/**
 * The finance dashboard as a board of widgets the member arranges: add,
 * remove, reorder and resize, saved to their own MemberPrefs row. Nobody
 * else's board changes.
 */
export function FinanceBoard({
  orgId,
  orgSlug,
  data,
  initialLayout,
  customized,
}: {
  orgId: string;
  orgSlug: string;
  data: DashboardData;
  initialLayout: Widget[];
  customized: boolean;
}) {
  const router = useRouter();
  const [layout, setLayout] = useState(initialLayout);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function persist(next: Widget[] | null) {
    setError(null);
    start(async () => {
      const result = await saveFinanceWidgetsAction(orgId, next);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  const move = (i: number, by: number) =>
    setLayout((l) => {
      const j = i + by;
      if (j < 0 || j >= l.length) return l;
      const next = [...l];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const resize = (i: number) =>
    setLayout((l) =>
      l.map((w, k) =>
        k === i ? { ...w, size: WIDGET_SIZES[(WIDGET_SIZES.indexOf(w.size) + 1) % WIDGET_SIZES.length] } : w,
      ),
    );
  const remove = (i: number) => setLayout((l) => l.filter((_, k) => k !== i));
  const add = (type: WidgetTypeId) => {
    setLayout((l) => [...l, { id: newWidgetId(type, l), type, size: widgetType(type).size }]);
    setAdding(false);
    setEditing(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          {editing ? "Arrange your board. Only you see these changes." : `Your board · ${data.period?.label}`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
                <Plus className="size-4" aria-hidden="true" />
                Add widget
              </Button>
              {customized && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => persist(null)}
                >
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {layout.map((w, i) => {
            const meta = widgetType(w.type);
            const Icon = WIDGET_ICONS[meta.icon] ?? ChartColumn;
            return (
              <Card
                key={w.id}
                className={cn(
                  SPAN[w.size],
                  "gap-3 transition-shadow",
                  editing && "ring-primary/30 border-dashed ring-2",
                )}
              >
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <CardTitle className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{meta.title}</span>
                  </CardTitle>
                  {editing && (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        aria-label={`Move ${meta.title} earlier`}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowLeft className="size-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        aria-label={`Move ${meta.title} later`}
                        disabled={i === layout.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowRight className="size-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        aria-label={`${meta.title} width: ${SIZE_LABEL[w.size]}. Change it`}
                        onClick={() => resize(i)}
                      >
                        {SIZE_LABEL[w.size]}
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="text-destructive size-7"
                        aria-label={`Remove ${meta.title}`}
                        onClick={() => remove(i)}
                      >
                        <X className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  )}
                </CardHeader>
                <CardContent>
                  <WidgetBody type={w.type} data={data} orgSlug={orgSlug} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add a widget</DialogTitle>
            <DialogDescription>
              Pick what you want to keep an eye on. You can add the same one twice, resize it, and
              move it around.
            </DialogDescription>
          </DialogHeader>
          {layout.length >= MAX_WIDGETS ? (
            <p className="text-muted-foreground text-sm">
              Your board is full ({MAX_WIDGETS} widgets). Remove one first.
            </p>
          ) : (
            <div className="space-y-5">
              {WIDGET_GROUPS.map((group) => (
                <section key={group} className="space-y-2">
                  <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                    {group}
                  </h3>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {WIDGET_TYPES.filter((t) => t.group === group).map((t) => {
                      const Icon = WIDGET_ICONS[t.icon] ?? ChartColumn;
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
                                  <span className="text-muted-foreground text-[11px] font-normal">
                                    on your board
                                  </span>
                                )}
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
    </div>
  );
}
