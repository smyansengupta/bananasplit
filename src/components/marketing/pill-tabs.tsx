"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export type PillTab = { id: string; label: string; icon?: ReactNode; panel: ReactNode };

/**
 * Tabs as a pill track (the product tour, the solutions): one pill per tab
 * and that tab's panel below. Every panel is rendered on the server and
 * passed in; the ones not chosen are hidden, so the first shows before
 * JavaScript runs. Arrow keys, Home and End move between tabs (the WAI-ARIA
 * tabs pattern). On phones the track scrolls sideways.
 */
export function PillTabs({
  tabs,
  label,
  align = "center",
  className,
}: {
  tabs: readonly PillTab[];
  /** What the tabs switch, for screen readers. */
  label: string;
  align?: "center" | "left";
  className?: string;
}) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const base = useId();

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const moves: Record<string, number> = {
      ArrowRight: active + 1,
      ArrowLeft: active - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = (moves[event.key] + tabs.length) % tabs.length;
    setActive(next);
    refs.current[next]?.focus();
  }

  return (
    <div className={cn("flex flex-col gap-6 sm:gap-8", className)}>
      <div className="flex max-sm:-mx-6 max-sm:[scrollbar-width:none] max-sm:overflow-x-auto max-sm:px-6">
        {/* Auto margins centre the track when it fits and let it scroll from the start when it doesn't. */}
        <div
          role="tablist"
          aria-label={label}
          className={cn(
            "bg-muted inline-flex flex-none gap-0.5 rounded-full p-1",
            align === "center" ? "mx-auto" : "mr-auto",
          )}
        >
          {tabs.map((tab, i) => (
            <button
              key={tab.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${tab.id}`}
              aria-selected={active === i}
              aria-controls={`${base}-panel-${tab.id}`}
              tabIndex={active === i ? 0 : -1}
              onClick={() => setActive(i)}
              onKeyDown={onKeyDown}
              className={cn(
                "inline-flex h-9 cursor-pointer items-center gap-2 rounded-full px-4 text-[14px] font-semibold whitespace-nowrap transition-[background-color,color,box-shadow] duration-200 max-sm:px-3 [&_svg]:size-4",
                active === i
                  ? "bg-thumb text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.14),var(--edge-highlight)]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      {tabs.map((tab, i) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${base}-panel-${tab.id}`}
          aria-labelledby={`${base}-tab-${tab.id}`}
          hidden={active !== i}
          className="motion-safe:animate-[ink-rise_420ms_var(--ease-ink)_backwards]"
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
