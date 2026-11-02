"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { BOARD_COLUMNS, MAX_ROWS, shapeName } from "@/lib/boards";
import { cn } from "@/lib/utils";

const COLS = Array.from({ length: BOARD_COLUMNS }, (_, i) => i + 1);
const ROWS = Array.from({ length: MAX_ROWS }, (_, i) => i + 1);

/**
 * A widget's shape drawn small: the board's four columns by three rows, with
 * the cells it covers filled. A widget that fits its content fills its
 * columns' first row and fades below it.
 */
export function ShapeIcon({
  w,
  h,
  className,
}: {
  w: number;
  h: number | null;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 19 14" aria-hidden="true" className={cn("h-3.5 w-[19px]", className)}>
      {ROWS.map((r) =>
        COLS.map((c) => {
          const on = c <= w && (h === null ? r === 1 : r <= h);
          const fade = h === null && c <= w && r > 1;
          return (
            <rect
              key={`${c}-${r}`}
              x={(c - 1) * 5}
              y={(r - 1) * 5}
              width={4}
              height={4}
              rx={1}
              className={cn(
                on ? "fill-current" : fade ? "fill-current opacity-35" : "fill-current opacity-15",
              )}
            />
          );
        }),
      )}
    </svg>
  );
}

/**
 * The shape control in a widget's Customize header: its shape and name,
 * opening a 4 by 3 grid to hover across, the way you'd size a table (the
 * name reads out as you go: Square, Rectangle, Big square, Full rectangle),
 * and a switch to let it fit its content instead.
 */
export function ShapePicker({
  title,
  w,
  h,
  compact,
  onChange,
}: {
  title: string;
  w: number;
  h: number | null;
  /** Only the shape on the button, for a widget one column wide. */
  compact?: boolean;
  onChange: (w: number, h: number | null) => void;
}) {
  const [hover, setHover] = useState<{ w: number; h: number } | null>(null);
  const fit = h === null;
  const shown = hover ?? { w, h: h ?? 1 };
  const readout = hover ? shapeName(hover.w, fit ? null : hover.h) : shapeName(w, h);

  return (
    <Popover onOpenChange={() => setHover(null)}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size={compact ? "icon-sm" : "sm"}
          variant="outline"
          aria-label={`${title} shape: ${shapeName(w, h)}`}
          title={compact ? shapeName(w, h) : undefined}
        >
          <ShapeIcon w={w} h={h} />
          {!compact && shapeName(w, h)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto gap-3">
        <p className="font-semibold">Shape</p>
        <div
          role="group"
          aria-label={`${title} shape`}
          className="grid w-max grid-cols-4 gap-1"
          onPointerLeave={() => setHover(null)}
        >
          {ROWS.map((r) =>
            COLS.map((c) => {
              const lit = c <= shown.w && (fit ? r === 1 : r <= shown.h);
              const current = c === w && (fit ? r === 1 : r === h);
              // The shape it is now stays faintly in view while you hover another.
              const now = c <= w && r <= (h ?? 1);
              return (
                <button
                  key={`${c}-${r}`}
                  type="button"
                  aria-label={`${shapeName(c, fit ? null : r)}: ${c} by ${fit ? "fit" : r}`}
                  aria-pressed={current}
                  disabled={fit && r > 1}
                  onPointerEnter={() => setHover({ w: c, h: r })}
                  onFocus={() => setHover({ w: c, h: r })}
                  onClick={() => onChange(c, fit ? null : r)}
                  className={cn(
                    "focus-glow rounded-[6px] outline-none transition-colors",
                    "size-9 disabled:opacity-30",
                    lit ? "bg-foreground" : now ? "bg-foreground/25" : "bg-muted",
                  )}
                />
              );
            }),
          )}
        </div>
        <p className="text-muted-foreground min-h-5 text-[13px]" aria-live="polite">
          <span className="text-foreground font-semibold">{readout}</span>
          {", "}
          {shown.w} {shown.w === 1 ? "column" : "columns"}
          {fit ? ", as tall as it needs" : `, ${shown.h} ${shown.h === 1 ? "row" : "rows"}`}
        </p>
        <label className="flex items-center justify-between gap-4 text-[13px]">
          Fit height to content
          <Switch
            checked={fit}
            onCheckedChange={(on) => onChange(w, on ? null : 1)}
            aria-label="Fit height to content"
          />
        </label>
      </PopoverContent>
    </Popover>
  );
}
