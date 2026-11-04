import { existsSync } from "node:fs";
import path from "node:path";

import { cn } from "@/lib/utils";

import type { Brand } from "./brands";

/** Whether public/marketing/logos/<slug>.svg exists (see SOURCES.txt there). Read once per slug. */
const logoCache = new Map<string, boolean>();
function hasLogo(slug: string): boolean {
  let found = logoCache.get(slug);
  if (found === undefined) {
    found = existsSync(path.join(process.cwd(), "public", "marketing", "logos", `${slug}.svg`));
    logoCache.set(slug, found);
  }
  return found;
}

/**
 * An app's logo on a white, rounded tile, the way integration directories
 * show them; the brand's colour and short mark when there's no logo file.
 * `tone="mono"` draws it in grey (the quiet row under the hero, like
 * Notion's customer logos). Decoration: the caller prints the name.
 */
export function BrandMark({
  brand,
  size = 40,
  tone = "brand",
}: {
  brand: Brand;
  size?: number;
  tone?: "brand" | "mono";
}) {
  const radius = Math.round(size * 0.26);
  if (hasLogo(brand.slug)) {
    return (
      <span
        aria-hidden="true"
        className="ring-foreground/10 grid flex-none place-items-center bg-white ring-1"
        style={{ width: size, height: size, borderRadius: radius }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- small static SVGs, nothing to optimise */}
        <img
          src={`/marketing/logos/${brand.slug}.svg`}
          alt=""
          width={Math.round(size * 0.62)}
          height={Math.round(size * 0.62)}
          className={cn(tone === "mono" && "opacity-70 grayscale")}
        />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="ring-foreground/10 grid flex-none place-items-center font-bold ring-1"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: brand.color,
        color: brand.ink,
        fontSize: Math.round(size * 0.42),
      }}
    >
      {brand.mark}
    </span>
  );
}
