"use client";

import { ChevronRight, Search } from "@/components/icons";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The Past list's search and folding (past-meeting-list.tsx draws the rows
 * on the server and hands them here). The newest months are open; older
 * ones fold to one line, "5 more in September", with Show. Searching opens
 * everything that matches.
 */

/** How many of the newest months start open. */
const OPEN_MONTHS = 2;

export interface PastMonth {
  key: string;
  label: string;
  rows: { id: string; text: string; node: ReactNode }[];
}

export function PastMeetingBrowser({ months, header }: { months: PastMonth[]; header: ReactNode }) {
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const q = query.trim().toLowerCase();
  const shown = months
    .map((m) => ({ ...m, rows: q ? m.rows.filter((r) => r.text.includes(q)) : m.rows }))
    .filter((m) => m.rows.length > 0);

  return (
    <div className="space-y-4">
      <label className="bg-card edge focus-within:outline-foreground flex h-10 max-w-sm items-center gap-2 rounded-full px-3.5 focus-within:outline-2 focus-within:outline-offset-2">
        <Search className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search past meetings"
          aria-label="Search past meetings"
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </label>

      {shown.length === 0 ? (
        <p className="text-muted-foreground px-1 text-sm">No past meetings match.</p>
      ) : (
        shown.map((m, i) => {
          const open = Boolean(q) || i < OPEN_MONTHS || opened.has(m.key);
          return (
            <section key={m.key} aria-label={m.label} className="space-y-2">
              <h3 className="flex items-baseline gap-2 px-1 text-[15px] font-semibold">
                {m.label}
                <span className="text-muted-foreground font-normal tabular-nums">
                  {m.rows.length}
                </span>
              </h3>
              <div className="bg-card edge rounded-card p-2 max-sm:p-1.5">
                {open && header}
                {open ? (
                  <ul>{m.rows.map((r) => r.node)}</ul>
                ) : (
                  <button
                    type="button"
                    onClick={() => setOpened((s) => new Set(s).add(m.key))}
                    className={cn(
                      "hover:bg-muted/60 rounded-field text-muted-foreground flex w-full items-center gap-2 px-3 py-3 text-left text-sm transition-colors",
                    )}
                  >
                    <ChevronRight className="size-4" aria-hidden="true" />
                    {m.rows.length} more in {m.label.split(" ")[0]}
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
