"use client";

import { ChevronDown, ChevronRight, Search } from "@/components/icons";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The Past list's heading, search, type menu and folding, as the workspace
 * plan draws it (past-meeting-list.tsx draws the rows on the server and
 * hands them here): "Past, 31 meetings", then Search past meetings and All
 * types on the right. The newest month is open; each older one shows its
 * first meeting, then "5 more in September" with Show. Searching or
 * picking a type opens everything that matches.
 */

/** How many of the newest months start open. */
const OPEN_MONTHS = 1;

export interface PastMonth {
  key: string;
  label: string;
  rows: { id: string; text: string; type: string | null; node: ReactNode }[];
}

const meetings = (n: number) => `${n} ${n === 1 ? "meeting" : "meetings"}`;

export function PastMeetingBrowser({
  months,
  total,
  types,
  header,
}: {
  months: PastMonth[];
  total: number;
  /** The types among them, for All types. */
  types: string[];
  header: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<string | null>(null);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const q = query.trim().toLowerCase();
  const narrowed = Boolean(q) || type !== null;
  const shown = months
    .map((m) => ({
      ...m,
      rows: m.rows.filter((r) => (!q || r.text.includes(q)) && (type === null || r.type === type)),
    }))
    .filter((m) => m.rows.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="past-heading" className="heading text-[17px]">
          Past
        </h2>
        <span className="text-muted-foreground text-[13px] tabular-nums">{meetings(total)}</span>
        <span className="flex-1" />
        <label className="bg-card edge focus-within:outline-foreground flex h-8 w-56 items-center gap-2 rounded-lg px-2.5 focus-within:outline-2 focus-within:outline-offset-2 max-sm:w-full">
          <Search className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search past meetings"
            aria-label="Search past meetings"
            className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none"
          />
        </label>
        {types.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                {type ?? "All types"}
                <ChevronDown className="size-3.5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={type ?? ""}
                onValueChange={(v) => setType(v === "" ? null : v)}
              >
                <DropdownMenuRadioItem value="">All types</DropdownMenuRadioItem>
                {types.map((t) => (
                  <DropdownMenuRadioItem key={t} value={t}>
                    {t}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="text-muted-foreground px-1 text-sm">No past meetings match.</p>
      ) : (
        shown.map((m, i) => {
          const open = narrowed || i < OPEN_MONTHS || opened.has(m.key);
          const rows = open ? m.rows : m.rows.slice(0, 1);
          const rest = m.rows.length - rows.length;
          return (
            <section key={m.key} aria-label={m.label} className="space-y-2">
              <h3 className="flex items-baseline gap-2 px-1 text-[15px] font-semibold">
                {m.label}
                <span className="text-muted-foreground text-[13px] font-normal tabular-nums">
                  {meetings(m.rows.length)}
                </span>
              </h3>
              <div className="bg-card edge rounded-card p-2 max-sm:p-1.5">
                {header}
                <ul>{rows.map((r) => r.node)}</ul>
                {rest > 0 && (
                  <button
                    type="button"
                    onClick={() => setOpened((s) => new Set(s).add(m.key))}
                    className="hover:bg-muted/60 rounded-field text-muted-foreground border-border flex w-full items-center gap-2 border-t px-3 py-3 text-left text-sm transition-colors"
                  >
                    <ChevronRight className="size-4" aria-hidden="true" />
                    {rest} more in {m.label.split(" ")[0]}
                    <span className="text-foreground ms-auto font-semibold">Show</span>
                  </button>
                )}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
