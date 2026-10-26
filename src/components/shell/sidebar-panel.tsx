"use client";

import { PanelLeft } from "@/components/icons";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { Logo } from "@/components/brand/logo";
import { useModKey } from "@/components/command-palette/use-mod-key";
import {
  SidebarModeProvider,
  surfaceTone,
  type SidebarState,
} from "@/components/shell/sidebar-mode-context";
import { overlayOpen } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

/** How long the pointer rests on the rail before the peek opens. */
const PEEK_DELAY_MS = 350;

export const SIDEBAR_ID = "app-sidebar";

/**
 * The platform's signature under the club's own nav: the Bananasplit mark
 * and wordmark (Young Serif, the logo's fixed colours), and the way back to
 * the home page. On the rail it tucks away and leaves the toggle.
 */
function SidebarLogo({ rail, onNavigate }: { rail: boolean; onNavigate?: () => void }) {
  return (
    <Link
      href="/"
      onClick={onNavigate}
      title="Bananasplit home page"
      tabIndex={rail ? -1 : undefined}
      aria-hidden={rail || undefined}
      className={cn(
        "focus-glow flex h-10 min-w-0 items-center overflow-hidden rounded-full px-1.5 whitespace-nowrap outline-none",
        "transition-[max-width,opacity] duration-500 ease-(--ease-ink) motion-reduce:transition-none",
        rail ? "max-w-0 flex-none px-0 opacity-0" : "max-w-[170px] flex-1 opacity-100 delay-75",
      )}
    >
      <Logo size={22} textSize={17} className="gap-2" />
    </Link>
  );
}

/**
 * The sidebar's insides, the same in every face: the club menu, the nav,
 * and the footer (logo, and the panel's collapse button when given).
 */
export function SidebarBody({
  clubMenu,
  children,
  toggle,
  rail = false,
  chrome = false,
  onNavigate,
}: {
  clubMenu: React.ReactNode;
  children: React.ReactNode;
  toggle?: React.ReactNode;
  rail?: boolean;
  chrome?: boolean;
  onNavigate?: () => void;
}) {
  const tone = surfaceTone(chrome);
  return (
    <>
      <div className="shrink-0 pb-3">{clubMenu}</div>
      {children}
      <div
        className={cn(
          "mt-2.5 flex shrink-0 items-center border-t pt-3 transition-colors duration-300",
          tone.border,
          rail ? "gap-0" : "gap-2.5",
        )}
      >
        <SidebarLogo rail={rail} onNavigate={onNavigate} />
        {toggle}
      </div>
    </>
  );
}

/**
 * The desktop sidebar, in three faces (src/components/shell/sidebar-mode-context.tsx):
 *
 * - docked (the default): 248px down the window's edge on the sidebar
 *   colour, with a hairline on its right;
 * - rail: lifted 14px off the edges into a 68px glass pill of 40px round
 *   icons; group names become hairlines, the pins fold into one Pin item,
 *   the club becomes a circle;
 * - peek: resting on the rail for 350ms, or tabbing into it, opens the
 *   labeled sidebar as glass (93%) over the page. The page never moves:
 *   the grid column stays the rail's. Leaving it, or Esc, tucks it back;
 *   the toggle docks it.
 *
 * Width, inset, corners and colour morph together over 500ms on the ink
 * curve, labels fading first (none of it with reduced motion). The toggle
 * and ⌘\ (keyboard-shortcuts.tsx) switch docked and rail; the shell keeps
 * the choice in a cookie (src/lib/sidebar-mode.ts).
 */
export function SidebarPanel({
  mode,
  setMode,
  onToggle,
  clubMenu,
  children,
}: {
  mode: SidebarState;
  setMode: React.Dispatch<React.SetStateAction<SidebarState>>;
  onToggle: () => void;
  clubMenu: React.ReactNode;
  children: React.ReactNode;
}) {
  const mod = useModKey();
  const asideRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hovering = useRef(false);
  // A menu opened from inside (the club menu) keeps the peek open: its
  // content is in a portal, so the pointer and focus leave the panel.
  const held = useRef(false);

  const rail = mode === "rail";
  const chrome = mode !== "docked";

  const peek = useCallback(() => setMode((m) => (m === "rail" ? "peek" : m)), [setMode]);
  const unpeek = useCallback(() => setMode((m) => (m === "peek" ? "rail" : m)), [setMode]);
  const cancelTimer = () => clearTimeout(timer.current);

  useEffect(() => () => clearTimeout(timer.current), []);

  // Esc tucks the peek away even when focus isn't in it (the pointer is).
  useEffect(() => {
    if (mode !== "peek") return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || overlayOpen()) return;
      const inside = asideRef.current?.contains(document.activeElement);
      unpeek();
      if (inside) toggleRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mode, unpeek]);

  const context = useMemo(
    () => ({
      mode,
      requestPeek: peek,
      holdPeek: (open: boolean) => {
        held.current = open;
        if (!open && !hovering.current) unpeek();
      },
    }),
    [mode, peek, unpeek],
  );

  const label = mode === "docked" ? "Collapse sidebar" : "Expand sidebar";
  const tone = surfaceTone(chrome);

  return (
    <div className="relative z-40 hidden md:block">
      <div className="sticky top-0 h-svh">
        {/* Docked's sheet: the sidebar colour and its hairline, sliding away as the rail lifts off. */}
        <div
          aria-hidden="true"
          className={cn(
            "bg-sidebar border-sidebar-border pointer-events-none absolute inset-y-0 left-0 w-[248px] border-r",
            "[transition:opacity_350ms,translate_500ms_var(--ease-ink)] motion-reduce:[transition:none]",
            chrome && "-translate-x-[70px] opacity-0",
          )}
        />
        <SidebarModeProvider value={context}>
          <aside
            ref={asideRef}
            id={SIDEBAR_ID}
            aria-label="Sidebar"
            data-mode={mode}
            onPointerEnter={(event) => {
              hovering.current = true;
              if (mode !== "rail" || event.pointerType === "touch") return;
              cancelTimer();
              timer.current = setTimeout(peek, PEEK_DELAY_MS);
            }}
            onPointerLeave={() => {
              hovering.current = false;
              cancelTimer();
              if (!held.current) unpeek();
            }}
            onFocus={(event) => {
              // Keyboard focus opens the peek (not a click, which would only
              // flash it open on the way to a page); the toggle stays itself.
              const target = event.target as HTMLElement;
              if (
                mode === "rail" &&
                target !== toggleRef.current &&
                target.matches(":focus-visible")
              ) {
                peek();
              }
            }}
            onBlur={(event) => {
              const next = event.relatedTarget as Node | null;
              if (held.current || hovering.current) return;
              if (!next || !asideRef.current?.contains(next)) unpeek();
            }}
            className={cn(
              "relative flex flex-col overflow-hidden",
              "[transition:width_500ms_var(--ease-ink),height_500ms_var(--ease-ink),margin_500ms_var(--ease-ink),padding_500ms_var(--ease-ink),border-radius_500ms_var(--ease-ink),background-color_350ms,box-shadow_350ms,color_350ms]",
              "motion-reduce:[transition:none]",
              mode === "docked" &&
                "text-sidebar-foreground m-0 h-svh w-[248px] rounded-none px-3.5 py-4",
              mode === "rail" && "glass m-3.5 h-[calc(100svh-28px)] w-[68px] rounded-[36px] p-3.5",
              mode === "peek" &&
                "glass m-3.5 h-[calc(100svh-28px)] w-64 rounded-[28px] p-3.5 [--glass-strength:93%]",
            )}
          >
            <SidebarBody
              clubMenu={clubMenu}
              rail={rail}
              chrome={chrome}
              toggle={
                <button
                  ref={toggleRef}
                  type="button"
                  onClick={() => {
                    cancelTimer();
                    onToggle();
                  }}
                  aria-label={label}
                  aria-expanded={mode !== "rail"}
                  aria-controls={SIDEBAR_ID}
                  aria-keyshortcuts="Meta+Backslash Control+Backslash"
                  title={`${label} (${mod === "⌘" ? "⌘\\" : "Ctrl \\"})`}
                  className={cn(
                    "focus-glow grid size-10 shrink-0 place-items-center rounded-full border outline-none",
                    "transition-[background-color,border-color,scale] duration-200 active:scale-[0.94] motion-reduce:transition-none",
                    tone.border,
                    tone.hover,
                  )}
                >
                  <PanelLeft
                    className={cn(
                      "size-5 transition-transform duration-500 ease-(--ease-ink) motion-reduce:transition-none",
                      chrome && "-scale-x-100",
                    )}
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                </button>
              }
            >
              {children}
            </SidebarBody>
          </aside>
        </SidebarModeProvider>
      </div>
    </div>
  );
}
