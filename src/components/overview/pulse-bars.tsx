"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Tasks finished per week, as columns (redesign guide 8.1): one hue (the
 * theme's first chart slot), 4px rounded tops on a shared baseline, a
 * dashed average line, and the week under way hatched because it isn't
 * over. Hover or arrow keys move the focus; the focused week's numbers sit
 * in the tooltip above its column. Text stays in the text tokens.
 */

export interface PulseBar {
  label: string;
  value: number;
}

function niceMax(v: number): number {
  if (v <= 4) return 4;
  if (v <= 8) return 8;
  if (v <= 10) return 10;
  const step = v <= 50 ? 10 : 50;
  return Math.ceil(v / step) * step;
}

export function PulseBars({
  bars,
  average,
  height = 188,
}: {
  bars: readonly PulseBar[];
  average: number;
  height?: number;
}) {
  const n = bars.length;
  const [focus, setFocus] = useState(Math.max(0, n - 2));
  if (n === 0) return null;
  const max = niceMax(Math.max(...bars.map((b) => b.value), average));
  const pct = (v: number) => (v / max) * 100;
  const avg = Math.round(average * 10) / 10;
  const f = Math.max(0, Math.min(n - 1, focus));
  const current = n - 1;

  return (
    <div
      tabIndex={0}
      role="img"
      aria-label={`Tasks finished each week. ${bars.map((b, i) => `${b.label}: ${b.value}${i === current ? " so far" : ""}`).join(", ")}. Average ${avg} a week.`}
      className="focus-visible:outline-foreground rounded-field outline-none focus-visible:outline-2 focus-visible:outline-offset-4"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          setFocus((v) => Math.min(n - 1, v + 1));
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          setFocus((v) => Math.max(0, v - 1));
        }
      }}
    >
      <div className="relative grid grid-cols-[1.75rem_minmax(0,1fr)]" style={{ height }}>
        {/* The scale: 0, half and the top. */}
        <div className="relative" aria-hidden="true">
          {[0, max / 2, max].map((t) => (
            <span
              key={t}
              className="text-muted-foreground absolute right-2 translate-y-1/2 text-[11px] tabular-nums"
              style={{ bottom: `${pct(t)}%` }}
            >
              {Number.isInteger(t) ? t : t.toFixed(1)}
            </span>
          ))}
        </div>
        <div className="relative" aria-hidden="true">
          {[max / 2, max].map((t) => (
            <span
              key={t}
              className="border-border/70 absolute inset-x-0 border-t border-dashed"
              style={{ bottom: `${pct(t)}%` }}
            />
          ))}
          <span className="bg-border absolute inset-x-0 bottom-0 h-px" />
          <div
            className="absolute inset-0 grid items-end gap-[6%] px-1"
            style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
            onPointerLeave={() => setFocus(Math.max(0, n - 2))}
          >
            {bars.map((b, i) => (
              <div
                key={b.label}
                className="relative flex h-full items-end justify-center"
                onPointerEnter={() => setFocus(i)}
              >
                <span
                  className={cn(
                    "relative block w-full max-w-11 rounded-t-[4px] transition-[height,opacity] duration-500",
                    i === current
                      ? "bg-[repeating-linear-gradient(135deg,var(--chart-1)_0_3px,transparent_3px_7px)] ring-1 ring-(--chart-1) ring-inset"
                      : "bg-(--chart-1)",
                    i !== f && i !== current && "opacity-75",
                  )}
                  style={{ height: `${Math.max(pct(b.value), b.value > 0 ? 3 : 1.2)}%` }}
                />
                {i === f && (
                  <span
                    className="bg-popover text-popover-foreground shadow-e2 ring-foreground/8 pointer-events-none absolute z-10 min-w-[7.5rem] -translate-y-2 rounded-[12px] px-2.5 py-2 text-[12px] whitespace-nowrap ring-1"
                    style={{ bottom: `${Math.max(pct(b.value), 3)}%` }}
                  >
                    <b className="block font-semibold">
                      {i === current ? "This week" : `Week of ${b.label}`}
                    </b>
                    <span className="text-muted-foreground">
                      {b.value} finished{i === current ? " so far" : ""}
                    </span>
                  </span>
                )}
              </div>
            ))}
          </div>
          {/* The average, across every week. */}
          <span
            className="border-foreground/70 pointer-events-none absolute inset-x-0 border-t-2 border-dashed"
            style={{ bottom: `${pct(average)}%` }}
          />
        </div>
      </div>
      <div className="mt-2 grid grid-cols-[1.75rem_minmax(0,1fr)] text-[11.5px]" aria-hidden="true">
        <span />
        <div
          className="grid gap-[6%] px-1"
          style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
        >
          {bars.map((b, i) => (
            <span
              key={b.label}
              className={cn(
                "truncate text-center",
                i === f ? "text-foreground font-semibold" : "text-muted-foreground",
                // Phones only have room for the ends and the focused week.
                i !== 0 && i !== current && i !== f && "max-sm:invisible",
              )}
            >
              {i === current ? "Now" : b.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
