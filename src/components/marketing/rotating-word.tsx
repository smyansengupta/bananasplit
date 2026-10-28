"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/** The headline's words, each in a colour from the tag palette (--tag-*, src/lib/tag-colors.ts): who Bananasplit keeps. */
const WORDS = [
  { word: "team", tone: "text-(--tag-navy)" },
  { word: "life", tone: "text-(--tag-plum)" },
  { word: "club", tone: "text-(--tag-forest)" },
  { word: "company", tone: "text-(--tag-rust)" },
] as const;

const EVERY_MS = 2600;

/**
 * The hero's changing word ("The new era of ___ keeping."): it rises in
 * every few seconds in a new colour. Screen readers get the headline once,
 * with "team", from the h1's own label; with reduced motion on it stays on
 * "team".
 */
export function RotatingWord() {
  const [index, setIndex] = useState(0);
  const [ticked, setTicked] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      setTicked(true);
      setIndex((i) => (i + 1) % WORDS.length);
    }, EVERY_MS);
    return () => window.clearInterval(timer);
  }, []);

  const { word, tone } = WORDS[index];
  return (
    <span
      key={word}
      className={cn(
        "inline-block",
        // The first word is simply there (on load, in a paused tab, in a link preview); the rest rise in.
        index > 0 || ticked
          ? "motion-safe:animate-[ink-rise_520ms_var(--ease-ink)_backwards]"
          : null,
        tone,
      )}
    >
      {word}
    </span>
  );
}
