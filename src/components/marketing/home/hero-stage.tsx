"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The home page hero's stage: sets --p from 0 to 1 as the page scrolls (0
 * at the top of the page, 1 once the stage has risen most of the way up the
 * screen), and its children read it in their transforms: the dashboard
 * eases up to full size, the phone rises over it (no tilt, nothing
 * rotates). Without JavaScript, or with reduced motion, --p is 1 and
 * nothing moves.
 */
export function HeroStage({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const vh = window.innerHeight;
      // How far the stage's top has come from where it starts towards 15% of the screen.
      const start = el.getBoundingClientRect().top + window.scrollY;
      const end = Math.max(1, start - vh * 0.15);
      const p = Math.min(1, Math.max(0, window.scrollY / end));
      el.style.setProperty("--p", p.toFixed(3));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div ref={ref} className={cn("[--p:1]", className)}>
      {children}
    </div>
  );
}
