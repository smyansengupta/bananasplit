"use client";

import { useId } from "react";

import { cn } from "@/lib/utils";

/*
 * The mark's drawing on a 64-unit grid (public/brand/bananasplit-mark.svg):
 * a lune between two arcs (its tips rounded by a stroke in the same ink),
 * a stem continuing its centre line, and two half-planes either side of a
 * cut across the middle. The far half slides on along the banana.
 */
const BANANA = "M15 15A25.5 25.5 0 0 0 51 47A41 41 0 0 1 15 15Z";
const STEM = "M14.98 17.6L15.04 9.6";
const NEAR_HALF = "-34.19,103.73 97.35,-44.26 23.36,-110.03 -108.19,37.96";
const FAR_HALF = "-31.35,106.26 100.19,-41.73 174.19,24.04 42.64,172.03";

function Plate({ ink, stem = true }: { ink: string; stem?: boolean }) {
  return (
    <g style={{ fill: ink, stroke: ink }}>
      <path d={BANANA} strokeWidth={3.2} strokeLinejoin="round" />
      {stem && <path d={STEM} fill="none" strokeWidth={3.6} strokeLinecap="square" />}
    </g>
  );
}

/**
 * The Bananasplit mark: a banana, split, printed in two inks. The top plate
 * carries the shape; the second sits off register behind it and shows
 * through the split. The inks are tokens, `--mark-top` (default: the
 * primary) and `--mark-under` (default: the accent), so on the default theme
 * this is exactly the logo, and inside a club it prints in the club's inks.
 * Decorative: pair it with the name.
 */
export function BananasplitMark({ className }: { className?: string }) {
  const id = useId();
  const top = "var(--mark-top, var(--primary))";
  const under = "var(--mark-under, var(--brand-accent))";
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn("size-8 shrink-0", className)}>
      <defs>
        <clipPath id={`${id}near`}>
          <polygon points={NEAR_HALF} />
        </clipPath>
        <clipPath id={`${id}far`}>
          <polygon points={FAR_HALF} />
        </clipPath>
      </defs>
      <g transform="translate(-1.2 0.4)">
        <g transform="translate(2.6 2.6)">
          <Plate ink={under} />
        </g>
        <g clipPath={`url(#${id}near)`}>
          <Plate ink={top} />
        </g>
        <g transform="translate(1.79 1.59)">
          <g clipPath={`url(#${id}far)`}>
            <Plate ink={top} stem={false} />
          </g>
        </g>
      </g>
    </svg>
  );
}
