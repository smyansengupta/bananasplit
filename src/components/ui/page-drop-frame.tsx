"use client";

import { useLayoutEffect, useState } from "react";

/** The frame's box in the window. */
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The page's own column (#main-content: beside the sidebar on a computer,
 * the whole width on a phone) as it sits in the window now, from its top
 * (or the window's, once scrolled past, below a phone's top bar) to the
 * window's foot.
 */
function pageBox(): Box {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const main = document.getElementById("main-content")?.getBoundingClientRect();
  if (!main) return { left: 0, top: 0, width, height };
  const left = Math.max(main.left, 0);
  const right = Math.min(main.right, width);
  // On a phone the sticky top bar stays over the page as it scrolls: start below it.
  const bar = document.querySelector("[data-tool-capsule]")?.getBoundingClientRect();
  const under = bar && bar.height > 0 ? bar.bottom : 0;
  const top = Math.min(Math.max(main.top, under, 0), height);
  return { left, top, width: Math.max(right - left, 0), height: height - top };
}

/**
 * What a page shows while files from the computer are dragged over it: a
 * dashed frame around the page and a hint pill at its foot, light enough
 * that what's under it (folder cards) stays visible to drop on. It frames
 * the page's column only, never the sidebar, and follows the window's size,
 * the sidebar's width and scrolling while it shows.
 */
export function PageDropFrame({ children }: { children: React.ReactNode }) {
  const [box, setBox] = useState<Box | null>(null);

  useLayoutEffect(() => {
    // Scrolling anywhere asks again; only a changed box redraws.
    const measure = () =>
      setBox((old) => {
        const next = pageBox();
        return old &&
          old.left === next.left &&
          old.top === next.top &&
          old.width === next.width &&
          old.height === next.height
          ? old
          : next;
      });
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { capture: true, passive: true });
    // The sidebar docking or folding changes the column's width without a resize.
    const main = document.getElementById("main-content");
    const observer = main ? new ResizeObserver(measure) : null;
    if (main) observer?.observe(main);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, { capture: true });
      observer?.disconnect();
    };
  }, []);

  if (!box) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed z-40" style={box}>
      <span className="border-foreground/30 rounded-shell absolute inset-3 border-2 border-dashed" />
      <span className="bg-card edge shadow-e2 animate-in fade-in-0 slide-in-from-bottom-2 absolute inset-x-0 bottom-8 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-2.5 rounded-full py-2 pr-4 pl-2 text-[14px] font-medium duration-200 motion-reduce:animate-none">
        {children}
      </span>
    </div>
  );
}
