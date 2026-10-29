"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The hero's logos on phones: colour tiles, six to a row. Tapping one names
 * its app in the line underneath, for visitors who don't know the logo;
 * tapping it again, anywhere else, or Escape clears it.
 * The marks are rendered on the server and passed in.
 */
export function LogoTiles({
  apps,
}: {
  apps: readonly { slug: string; name: string; mark: React.ReactNode }[];
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const name = apps.find((app) => app.slug === picked)?.name;
  const root = useRef<HTMLDivElement>(null);

  // Only the tapped logo is picked: a tap anywhere else, or Escape, clears it.
  useEffect(() => {
    if (!picked) return;
    function onPointerDown(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setPicked(null);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setPicked(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [picked]);

  return (
    <div ref={root} className="flex flex-col items-center gap-3">
      {/* Exactly six 48px tiles wide, so a short last row centres under a full one. */}
      <ul className="m-0 flex w-[328px] max-w-full list-none flex-wrap justify-center gap-2 p-0">
        {apps.map((app) => (
          <li key={app.slug}>
            <button
              type="button"
              aria-label={app.name}
              aria-pressed={picked === app.slug}
              onClick={() => setPicked(picked === app.slug ? null : app.slug)}
              className={cn(
                "bg-muted/70 grid size-12 cursor-pointer place-items-center rounded-[14px] transition-shadow",
                picked === app.slug && "ring-foreground ring-2",
              )}
            >
              {app.mark}
            </button>
          </li>
        ))}
      </ul>
      <span aria-live="polite" className="text-foreground/70 h-5 text-[13px] font-semibold">
        {name}
      </span>
    </div>
  );
}
