"use client";

import type { IconComponent } from "@/components/icons";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The stat strip (Moonstone): no boxes. Each stat is an icon chip, a big
 * number in the display face and a plain label, set straight on the page,
 * with an optional chip for context ("1 due today"). Four at most; on a
 * phone they form a 2×2 grid.
 */
export function StatStrip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-x-3 gap-y-4 sm:flex sm:flex-wrap sm:gap-x-11 sm:gap-y-4.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Stat({
  icon: Icon,
  value,
  label,
  chip,
  className,
}: {
  icon: IconComponent;
  /** A number counts up the first time it scrolls into view. */
  value: ReactNode;
  label: ReactNode;
  chip?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5 sm:gap-3.5", className)}>
      <IconChip icon={Icon} size="lg" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="numeral text-[23px] sm:text-[28px]">
            {typeof value === "number" ? <CountUp value={value} /> : value}
          </span>
          {chip && <span className="max-sm:hidden">{chip}</span>}
        </div>
        <p className="text-muted-foreground mt-1.5 text-[13px]">{label}</p>
      </div>
    </div>
  );
}

/** An icon in a circle: tiles (sm, 36px), nav (md, 44px) and the stat strip (lg, 52px). */
export function IconChip({
  icon: Icon,
  size = "sm",
  className,
}: {
  icon: IconComponent;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "bg-card ring-foreground/6 grid shrink-0 place-items-center rounded-full ring-1",
        size === "lg" && "edge size-[42px] sm:size-[52px]",
        size === "md" && "edge size-11",
        size === "sm" && "size-9 shadow-[var(--edge-highlight)]",
        className,
      )}
    >
      <Icon className={size === "sm" ? "size-[18px]" : "size-5 sm:size-6"} aria-hidden="true" />
    </span>
  );
}

/** A whole number that counts up once, the first time it is seen (700ms, ease-out). */
export function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);

  useEffect(() => {
    const el = ref.current;
    if (!el || !Number.isInteger(value) || value <= 1) return;
    if (typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        const start = performance.now();
        const step = (now: number) => {
          const t = Math.min(1, (now - start) / 700);
          setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
          if (t < 1) frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
      },
      { threshold: 0.6 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value]);

  return (
    <span ref={ref} className="tabular-nums">
      {shown}
    </span>
  );
}
