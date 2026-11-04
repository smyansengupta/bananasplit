"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { ChevronRight } from "@/components/icons";

/**
 * "More": what's rarely touched, folded away at the bottom of a settings
 * section. Still reachable by link: it opens itself when the URL's #anchor
 * is a card inside it.
 */
export function SettingsMore({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function reveal() {
      const id = window.location.hash.slice(1);
      const target = id ? document.getElementById(id) : null;
      if (!target || !ref.current?.contains(target)) return;
      ref.current.open = true;
      target.scrollIntoView({ block: "start" });
    }
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, []);
  return (
    <details ref={ref} className="group/more">
      <summary className="bg-card ring-foreground/6 hover:bg-muted/40 rounded-card flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-[15px] font-semibold ring-1 transition-colors [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-4 transition-transform group-open/more:rotate-90"
          aria-hidden="true"
        />
        More
      </summary>
      <div className="mt-4.5 space-y-4.5">{children}</div>
    </details>
  );
}
