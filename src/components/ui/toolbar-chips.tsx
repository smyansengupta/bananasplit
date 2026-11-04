"use client";

import { SlidersHorizontal, X, type IconComponent } from "@/components/icons";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { chipClass } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

/**
 * The pieces of a list's toolbar, shared by Tasks and People so the two
 * read the same: ExpandChip (an icon that opens up to say what it is, for
 * whose work or who to show), FiltersMenu (one Filters chip opening every
 * filter under its name) and FilterPill (what's narrowing the list, each
 * removable on its own).
 */

/**
 * A chip that is just its icon until you hover or focus it, then opens up
 * to say what it is (Mine, My team, Everyone). Filled when it's on.
 */
export function ExpandChip({
  icon: Icon,
  label,
  active,
  onClick,
  title,
}: {
  icon: IconComponent;
  label: string;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
      className={cn(chipClass(active), "group/expand gap-0 px-3")}
    >
      <Icon className="size-4 flex-none" aria-hidden="true" />
      <span
        aria-hidden="true"
        className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-[max-width,opacity,margin] duration-300 ease-(--ease-ink) group-hover/expand:ms-1.5 group-hover/expand:max-w-32 group-hover/expand:opacity-100 group-focus-visible/expand:ms-1.5 group-focus-visible/expand:max-w-32 group-focus-visible/expand:opacity-100 motion-reduce:transition-none"
      >
        {label}
      </span>
    </button>
  );
}

export function FilterPill({
  label,
  icon,
  onClear,
}: {
  label: string;
  icon?: React.ReactNode;
  onClear: () => void;
}) {
  return (
    <span className="bg-muted text-foreground inline-flex h-8 items-center gap-1.5 rounded-full ps-3.5 pe-1 text-[13px] font-medium">
      {icon}
      {label}
      <button
        type="button"
        aria-label={`Remove filter ${label}`}
        onClick={onClear}
        className="text-muted-foreground hover:text-foreground hover:bg-background grid size-6 place-items-center rounded-full transition-colors"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

/**
 * Filters: one chip, one panel, at every size.
 *
 * It used to have two behaviours. On a container wider than 64rem the
 * filter pills slid out into the bar beside the chip; narrower than that
 * they were packed into a popover. The trouble was everything in between —
 * a MacBook, a docked sidebar, a half-width window — where the pills had
 * just enough room to appear and not enough to sit side by side, so Tag and
 * Status rode over the search box and the row turned to mush. Hover opened
 * it, too, which a touch screen cannot do at all.
 *
 * So: the chip opens a panel, each filter under its own name, the way the
 * phone's sheet already reads. Nothing is ever injected into the row, so
 * nothing in the row can be run over, and the bar is the same shape whether
 * it has 400px or 2000px. Click or Enter opens it; Escape closes it.
 */
export function FiltersMenu({
  count,
  items,
}: {
  count: number;
  items: readonly { name: string; node: React.ReactNode }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={count > 0 ? `Filters, ${count} on` : "Filters"}
        className={chipClass(open || count > 0)}
      >
        <SlidersHorizontal className="size-3.5" aria-hidden="true" />
        Filters
        {count > 0 && <Badge className="h-4 min-w-4 px-1 text-[10px]">{count}</Badge>}
      </PopoverTrigger>
      <PopoverContent align="start" className="grid w-72 gap-3 p-3">
        {items.map((item) => (
          <div key={item.name} className="grid min-w-0 gap-1.5">
            <span className="text-muted-foreground text-[13px] font-medium">{item.name}</span>
            {/*
              Each pill fills its row here, so the panel reads as a form:
              the icon, then the value filling the width, then the chevron.
            */}
            <div className="[&>*]:w-full [&>*]:justify-between [&>*>span]:max-w-none [&>*>span]:flex-1 [&>*>span]:text-start">
              {item.node}
            </div>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
