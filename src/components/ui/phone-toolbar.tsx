"use client";

import { Search, SlidersHorizontal } from "@/components/icons";
import { useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { chipClass } from "@/components/ui/segmented";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/**
 * The one toolbar a list page has on a phone (Tasks, Files, People), so they
 * all work the same way: on the left the page's own switch (whose tasks,
 * grid or list), then Filters with a count (it opens a FilterSheet), and a
 * search icon at the right that turns the row into the search box, with
 * Cancel to put the row back. Shown below md only; the desktop keeps its
 * own bar.
 */
export function PhoneToolbar({
  leading,
  middle,
  filterCount,
  onFilters,
  searchLabel,
  searchActive,
  search,
  onCancelSearch,
}: {
  leading?: ReactNode;
  /** Fills the room between the switch and Filters (Tasks' layout picker). */
  middle?: ReactNode;
  filterCount: number;
  onFilters: () => void;
  /** The search icon's name ("Search tasks"). */
  searchLabel: string;
  /** A search is applied: the row opens as the search box. */
  searchActive: boolean;
  /** The search box, focused when it appears. */
  search: ReactNode;
  /** Cancel: clear the search (when there is one). */
  onCancelSearch: () => void;
}) {
  const [searching, setSearching] = useState(searchActive);

  if (searching) {
    return (
      <div className="flex items-center gap-2 md:hidden">
        <div className="min-w-0 flex-1">{search}</div>
        <Button
          variant="ghost"
          className="h-10 shrink-0 rounded-full px-3.5"
          onClick={() => {
            onCancelSearch();
            setSearching(false);
          }}
        >
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 md:hidden">
      {leading}
      {middle ? <div className="flex min-w-0 flex-1">{middle}</div> : <span className="flex-1" />}
      <Button
        variant="outline"
        className="h-10 shrink-0 gap-1.5 rounded-full px-3"
        onClick={onFilters}
        aria-haspopup="dialog"
      >
        <SlidersHorizontal className="size-4" aria-hidden="true" />
        Filters
        {filterCount > 0 && <Badge className="h-4 min-w-4 px-1 text-[10px]">{filterCount}</Badge>}
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="shrink-0"
        aria-label={searchLabel}
        onClick={() => setSearching(true)}
      >
        <Search className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

/**
 * The phone's filters, from the bottom: a title, the page's choices (each
 * group under its name, FilterChoices), and Clear all / Done.
 */
export function FilterSheet({
  open,
  onOpenChange,
  title,
  description,
  canClear,
  onClear,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  canClear: boolean;
  onClear: () => void;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[85svh] gap-0 overflow-y-auto pb-[env(safe-area-inset-bottom)]"
      >
        <SheetHeader className="pb-2">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4 py-2">{children}</div>
        <SheetFooter className="flex-row">
          <Button
            variant="ghost"
            className="flex-1"
            disabled={!canClear}
            onClick={() => {
              onClear();
              onOpenChange(false);
            }}
          >
            Clear all
          </Button>
          <Button className="flex-1" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** One named group of choices in a FilterSheet (chips, one picked). */
export function FilterChoices({
  title,
  value,
  options,
  onPick,
}: {
  title: string;
  value: string;
  options: readonly { value: string; label: ReactNode; color?: string }[];
  onPick: (value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="text-muted-foreground mb-2 text-[13px] font-medium">{title}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={o.value === value}
            onClick={() => onPick(o.value)}
            className={chipClass(o.value === value)}
          >
            {o.color && (
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ background: o.color }}
              />
            )}
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
