"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CalendarRange } from "@/components/icons";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { useReportsFrame } from "./reports-frame";

export type RangePresetId = "term" | "30d" | "all" | "custom";

const PRESETS: { id: Exclude<RangePresetId, "custom">; label: string }[] = [
  { id: "term", label: "This term" },
  { id: "30d", label: "30 days" },
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
 * The global date range: the presets as a switch bar (one click each) and
 * a calendar button for a custom range, which shows the range once picked.
 * Selecting navigates to ?range=... or ?from=&to= inside the shared
 * transition; every report below re-renders against the same range.
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
    <div className="flex flex-wrap items-center gap-2">
      <Segmented
        label="Date range"
        options={PRESETS.map((p) => ({ value: p.id, label: p.label }))}
        value={preset === "custom" ? "" : preset}
        onSelect={(id) => go(id === "term" ? {} : { range: id })}
        className={cn(pending && "opacity-80")}
      />
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setCustom(true);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size={preset === "custom" ? "default" : "icon"}
            aria-label={preset === "custom" ? `Date range: ${label}` : "Custom range"}
            title="Custom range"
          >
            <CalendarRange aria-hidden="true" />
            {preset === "custom" && <span className="font-medium">{span ?? label}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-1.5">
          {custom && (
            <div className="flex flex-col gap-2">
              <Calendar
                mode="range"
                numberOfMonths={1}
                selected={draft}
                onSelect={setDraft}
                defaultMonth={draft?.from ?? new Date()}
                autoFocus
              />
              <div className="flex items-center justify-end gap-2 px-1 pb-1">
                <Button
                  size="sm"
                  disabled={!draft?.from || !draft?.to}
                  onClick={() => {
                    if (draft?.from && draft?.to)
                      go({ from: toIsoDate(draft.from), to: toIsoDate(draft.to) });
                  }}
                >
                  Apply
                </Button>
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
