import type { ReactNode } from "react";

import type { Source } from "@/lib/onboarding/sources";

/** An app's tile: its colour and short mark, or `logo` (a BrandMark from the server) when given. */
export function SourceTile({
  source,
  size = 36,
  logo,
}: {
  source: Pick<Source, "color" | "ink" | "mark" | "name" | "logo">;
  size?: number;
  logo?: ReactNode;
}) {
  if (logo) return <>{logo}</>;
  if (source.logo) {
    return (
      <span
        aria-hidden="true"
        className="ring-foreground/8 grid flex-none place-items-center rounded-[10px] bg-white ring-1"
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a small static SVG */}
        <img src={source.logo} alt="" className="size-[64%] object-contain" />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="ring-foreground/8 grid flex-none place-items-center rounded-[10px] font-bold ring-1"
      style={{
        width: size,
        height: size,
        backgroundColor: source.color,
        color: source.ink,
        fontSize: Math.round(size * 0.42),
      }}
    >
      {source.mark}
    </span>
  );
}
