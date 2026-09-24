"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CalendarRange, Check, ChevronDown } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { useReportsFrame } from "./reports-frame";

export type RangePresetId = "term" | "30d" | "all" | "custom";

const PRESETS: { id: Exclude<RangePresetId, "custom">; label: string }[] = [
  { id: "term", label: "This term" },
  { id: "30d", label: "Last 30 days" },
  { id: "all", label: "All time" },
];

function toIsoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function fromIsoDate(s: string | null): Date | undefined {
  if (!s) return undefined;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * The global date range: presets as rows (checked when selected), a custom
 * range behind a hairline in the footer. Selecting navigates to
 * ?range=... or ?from=&to= inside the shared transition; every report below
 * re-renders against the same range.
 */
export function RangePicker({
  preset,
  from,
  to,
  label,
  span,
}: {
  preset: RangePresetId;
  from: string | null;
  to: string | null;
  label: string;
  span: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { startTransition, pending } = useReportsFrame();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(preset === "custom");
  const [draft, setDraft] = useState<DateRange | undefined>(
    preset === "custom" ? { from: fromIsoDate(from), to: fromIsoDate(to) } : undefined,
  );

  function go(query: Record<string, string>) {
    const qs = new URLSearchParams(query).toString();
    setOpen(false);
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setCustom(preset === "custom");
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="lg" className="max-w-full justify-start" aria-label={`Date range: ${label}`}>
          <CalendarRange aria-hidden="true" />
          <span className="font-medium">{label}</span>
          {span && span !== label ? (
            <span className="text-muted-foreground hidden truncate font-normal sm:inline">{span}</span>
          ) : null}
          <ChevronDown className={cn("text-muted-foreground", pending && "animate-pulse")} aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn("p-1.5", custom ? "w-auto" : "w-60")}>
        <ul role="listbox" aria-label="Date range presets" className="flex flex-col">
          {PRESETS.map((p) => {
            const selected = preset === p.id;
            return (
              <li key={p.id} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => go(p.id === "term" ? {} : { range: p.id })}
                  className="hover:bg-muted/60 focus-visible:bg-muted flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm outline-none"
                >
                  <span className={cn(selected && "font-medium")}>{p.label}</span>
                  {selected ? <Check className="size-4" strokeWidth={2.5} aria-hidden="true" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-1 border-t pt-1">
          {!custom ? (
            <button
              type="button"
              onClick={() => setCustom(true)}
              className="hover:bg-muted/60 focus-visible:bg-muted flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm outline-none"
            >
              <span className={cn(preset === "custom" && "font-medium")}>Custom range…</span>
              {preset === "custom" ? <Check className="size-4" strokeWidth={2.5} aria-hidden="true" /> : null}
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              <Calendar
                mode="range"
                numberOfMonths={1}
                selected={draft}
                onSelect={setDraft}
                defaultMonth={draft?.from ?? new Date()}
                autoFocus
              />
              <div className="flex items-center justify-between gap-2 px-1 pb-1">
                <span className="text-muted-foreground text-xs">
                  {draft?.from && draft?.to ? "" : "Pick a first and last day."}
                </span>
                <Button
                  size="sm"
                  disabled={!draft?.from || !draft?.to}
                  onClick={() => {
                    if (draft?.from && draft?.to) go({ from: toIsoDate(draft.from), to: toIsoDate(draft.to) });
                  }}
                >
                  Apply
                </Button>
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
