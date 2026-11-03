"use client";

import { Building2, Check, ChevronDown, Columns3, Search, UserRound, X } from "@/components/icons";
import { useEffect, useRef, useState } from "react";

import { searchCrmAction, type PickerHit } from "@/app/app/[orgSlug]/crm/actions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Picks a CRM person, company or item: a pill that opens a search box,
 * searched on the server as you type (the viewer's own RLS), with the most
 * recently changed ones before you type anything.
 */
export function CrmPicker({
  orgId,
  kind,
  value,
  display,
  onPick,
  placeholder,
  allowClear = true,
  className,
  autoOpen = false,
}: {
  orgId: string;
  kind: "person" | "company" | "deal";
  value: string | null;
  display?: string | null;
  onPick: (hit: PickerHit | null) => void;
  placeholder?: string;
  allowClear?: boolean;
  className?: string;
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(autoOpen);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PickerHit[]>([]);
  const [active, setActive] = useState(0);
  const seq = useRef(0);
  const Icon = kind === "person" ? UserRound : kind === "company" ? Building2 : Columns3;

  useEffect(() => {
    if (!open) return;
    const n = ++seq.current;
    const t = setTimeout(async () => {
      const r = await searchCrmAction(orgId, kind, q).catch(() => null);
      if (n !== seq.current || !r || !r.ok) return;
      setHits(r.hits);
      setActive(0);
    }, 140);
    return () => clearTimeout(t);
  }, [open, q, orgId, kind]);

  const pick = (hit: PickerHit | null) => {
    onPick(hit);
    setOpen(false);
    setQ("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "border-input hover:bg-muted inline-flex h-9 max-w-full min-w-0 items-center gap-2 rounded-full border px-3 text-sm",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">
            {value ? (display ?? "Picked") : (placeholder ?? "Pick")}
          </span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1.5">
        <div className="relative mb-1">
          <Search
            className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, hits.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && hits[active]) {
                e.preventDefault();
                pick(hits[active]!);
              }
            }}
            placeholder={
              kind === "person"
                ? "Search people"
                : kind === "company"
                  ? "Search companies"
                  : "Search items"
            }
            aria-label="Search"
            className="bg-muted/60 h-9 w-full rounded-full ps-9 pe-3 text-sm outline-none"
          />
        </div>
        <div role="listbox" className="flex max-h-64 flex-col gap-px overflow-y-auto">
          {hits.length === 0 && (
            <p className="text-muted-foreground px-3 py-2 text-sm">Nothing found.</p>
          )}
          {hits.map((h, i) => (
            <button
              key={h.id}
              type="button"
              role="option"
              aria-selected={h.id === value}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(h)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm",
                i === active && "bg-muted",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{h.label}</span>
                {h.sub && (
                  <span className="text-muted-foreground block truncate text-xs">{h.sub}</span>
                )}
              </span>
              {h.id === value && <Check className="size-3.5" aria-hidden="true" />}
            </button>
          ))}
          {allowClear && value && (
            <button
              type="button"
              onClick={() => pick(null)}
              className="text-muted-foreground hover:bg-muted flex items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm"
            >
              <X className="size-3.5" aria-hidden="true" />
              Clear
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
