"use client";

import { createContext, useContext } from "react";

import { cn } from "@/lib/utils";

/**
 * Which face the sidebar is showing, for everything drawn inside it:
 *
 * - docked: the labeled sidebar on the theme's sidebar colour (also the
 *   phone's More sheet);
 * - rail: collapsed into a glass strip, icons only;
 * - peek: the labeled sidebar floating over the page as glass, while the
 *   pointer rests on the rail or focus is inside it.
 *
 * Rail and peek sit on the chrome colour, so their text and hovers come
 * from --chrome-foreground; docked's from the sidebar tokens.
 */
export type SidebarState = "docked" | "rail" | "peek";

interface SidebarModeValue {
  mode: SidebarState;
  /** Opens the peek from inside the rail (its Pinned item). */
  requestPeek?: () => void;
  /** A menu opened from the sidebar (the club menu): keep the peek open meanwhile. */
  holdPeek?: (open: boolean) => void;
}

const SidebarModeContext = createContext<SidebarModeValue>({ mode: "docked" });

export const SidebarModeProvider = SidebarModeContext.Provider;

export function useSidebarMode(): SidebarModeValue & {
  /** Collapsed: icons only, labels hidden. */
  rail: boolean;
  /** On the glass chrome (rail or peek). */
  chrome: boolean;
} {
  const value = useContext(SidebarModeContext);
  return { ...value, rail: value.mode === "rail", chrome: value.mode !== "docked" };
}

/** The 500ms morph every part of the sidebar shares (width, corners, inset). */
export const MORPH = "duration-500 ease-(--ease-ink) motion-reduce:[transition:none]";

/** Text that fades as the sidebar collapses (labels first), and back after it opens. */
export function fadeLabel(rail: boolean): string {
  return cn(
    "transition-opacity duration-200 motion-reduce:transition-none",
    rail ? "opacity-0 delay-0" : "opacity-100 delay-150",
  );
}

/**
 * Quiet text, hover and hairline colours for the sidebar's current surface.
 * A hover is a light wash of the accent, the same colour that fills the row
 * you're on.
 */
export function surfaceTone(chrome: boolean) {
  return chrome
    ? {
        text: "text-chrome-foreground/75",
        quiet: "text-chrome-foreground/60",
        hover: "hover:bg-chrome-accent/20 hover:text-chrome-foreground",
        line: "bg-chrome-foreground/15",
        border: "border-chrome-foreground/15",
      }
    : {
        text: "text-sidebar-foreground/75",
        quiet: "text-sidebar-foreground/60",
        hover: "hover:bg-brand-accent/15 hover:text-sidebar-foreground",
        line: "bg-sidebar-border",
        border: "border-sidebar-border",
      };
}
