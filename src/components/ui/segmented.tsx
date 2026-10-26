"use client";

import type { IconComponent } from "@/components/icons";
import Link from "next/link";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The one view switcher (Board / Table, Month / Week, Grid / List...): a
 * pill track with a thumb that springs to the chosen option. Options are
 * links (`href`) or buttons (`onSelect`). 40px tall, like every default
 * control in a page header or toolbar.
 */
export interface SegmentedOption {
  value: string;
  label: ReactNode;
  icon?: IconComponent;
  href?: string;
  /** Hide the label below `sm`, keeping the icon (and the label for screen readers). */
  compact?: boolean;
  title?: string;
}

export const segmentedTrack =
  "bg-muted relative inline-flex h-10 shrink-0 items-center gap-0.5 rounded-full p-1";

/**
 * One option. Active options get the raised thumb colour themselves, unless
 * `thumb` says a sliding thumb (Segmented, once measured) paints it.
 */
export function segmentedItem(active: boolean, options: { thumb?: boolean } = {}) {
  return cn(
    "relative z-[1] inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[0.8125rem] whitespace-nowrap transition-colors duration-200 outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground [&_svg]:size-4 [&_svg]:shrink-0",
    active
      ? cn(
          "text-foreground font-semibold",
          !options.thumb && "bg-thumb shadow-[0_1px_2px_rgb(0_0_0/0.14),var(--edge-highlight)]",
        )
      : "text-muted-foreground hover:text-foreground font-medium",
  );
}

/**
 * A filter chip (search scopes, calendar categories, "whose tasks"): a
 * small pill toggle, filled with the primary when on.
 */
export function chipClass(active: boolean) {
  return cn(
    "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground [&_svg]:size-4",
    active
      ? "bg-primary text-primary-foreground border-transparent"
      : "border-input text-foreground hover:bg-muted",
  );
}

export function Segmented({
  options,
  value,
  onSelect,
  label,
  labelsFrom,
  className,
}: {
  options: readonly SegmentedOption[];
  value: string;
  onSelect?: (value: string) => void;
  /** What the group switches, for screen readers ("Layout", "View"). */
  label: string;
  /**
   * When a `compact` option shows its label beside the icon. The default is
   * the viewport (`sr-only sm:not-sr-only`), which is wrong inside a bar that
   * has to fit whatever room is left: the task toolbar passes a container
   * query so the labels go when the BAR is tight, not when the window is.
   */
  labelsFrom?: string;
  className?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number; animate: boolean } | null>(
    null,
  );

  // Measure the active option and spring the thumb to it (550ms, a slight
  // overshoot). The first placement doesn't animate.
  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const place = () => {
      const active = el.querySelector<HTMLElement>("[data-active='true']");
      if (!active || active.offsetWidth === 0) return;
      setThumb((prev) => ({
        left: active.offsetLeft,
        width: active.offsetWidth,
        animate: prev !== null,
      }));
    };
    place();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(place);
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);

  return (
    <div ref={track} role="group" aria-label={label} className={cn(segmentedTrack, className)}>
      {thumb && (
        <span
          aria-hidden="true"
          className={cn(
            "bg-thumb absolute top-1 bottom-1 left-0 rounded-full shadow-[0_1px_2px_rgb(0_0_0/0.14),var(--edge-highlight)] motion-reduce:transition-none",
            thumb.animate && "transition-[transform,width] duration-[550ms] ease-(--ease-spring)",
          )}
          style={{ transform: `translateX(${thumb.left}px)`, width: thumb.width }}
        />
      )}
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        const content = (
          <>
            {Icon && <Icon aria-hidden="true" />}
            <span className={cn(o.compact && Icon && (labelsFrom ?? "sr-only sm:not-sr-only"))}>
              {o.label}
            </span>
          </>
        );
        const itemClass = segmentedItem(active, { thumb: thumb !== null });
        return o.href ? (
          <Link
            key={o.value}
            href={o.href}
            title={o.title}
            data-active={active}
            aria-current={active ? "page" : undefined}
            className={itemClass}
          >
            {content}
          </Link>
        ) : (
          <button
            key={o.value}
            type="button"
            title={o.title}
            data-active={active}
            aria-pressed={active}
            onClick={() => onSelect?.(o.value)}
            className={itemClass}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
