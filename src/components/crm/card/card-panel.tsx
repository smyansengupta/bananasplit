"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { DialogHead } from "@/components/ui/dialog";

/**
 * A panel over the card it was opened from (docs/features/crm.md, "Cards"):
 * History, Add to a follow-up series. Never a second dialog: it covers the
 * card's own frame (its DialogContent) with the shared header, whose Close
 * goes back to the card. Escape closes the panel, not the card (CrmCard
 * leaves Escape to an open panel), and focus moves into it and back to the
 * button that opened it. Outside a card it covers the screen.
 */
export function CardPanel({
  host,
  title,
  subtitle,
  label,
  onClose,
  returnFocus,
  children,
}: {
  /** The card's DialogContent, or the page's body outside a card. */
  host: HTMLElement;
  title: string;
  subtitle?: ReactNode;
  /** For screen readers ("History of Ada Lovelace"). */
  label: string;
  onClose: () => void;
  /** Where focus goes back to on close (the card's "…"). */
  returnFocus?: HTMLElement | null;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const card = host !== document.body;
  useEscapeFirst(onClose);

  useEffect(() => {
    // After the menu that opened it has handed focus back.
    const t = setTimeout(() => ref.current?.focus(), 0);
    return () => {
      clearTimeout(t);
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [returnFocus]);

  const panel = (
    <section
      ref={ref}
      tabIndex={-1}
      data-card-panel
      aria-label={label}
      className={
        card
          ? "bg-background absolute inset-0 z-10 flex flex-col outline-none"
          : "bg-background fixed inset-0 z-50 flex flex-col outline-none"
      }
    >
      <header className="border-border/60 shrink-0 border-b ps-6 pe-4 pt-4 pb-3.5 max-sm:ps-4">
        <DialogHead
          plainTitle
          title={
            <h2 className="display-title truncate text-[26px] leading-tight max-sm:text-[22px]">{title}</h2>
          }
          subtitle={subtitle}
          onClose={onClose}
        />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
  return createPortal(panel, host);
}

/**
 * Escape for something inside a card (a panel, a stage's questions): it
 * goes, the card stays. Mark the element `data-card-panel` so CrmCard
 * leaves Escape alone while it's there.
 */
export function useEscapeFirst(onEscape: () => void) {
  const ref = useRef(onEscape);
  useEffect(() => {
    ref.current = onEscape;
  });
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      ref.current();
    }
    document.addEventListener("keydown", onKey, { capture: true });
    return () => document.removeEventListener("keydown", onKey, { capture: true });
  }, []);
}

/**
 * Where a CardPanel goes: put `anchor` on a hidden span inside the card,
 * call `show(trigger)` to open it over that card. `host` is null when shut.
 */
export function useCardPanel() {
  // A callback ref (state, not a ref object), so render can hand it out.
  const [anchorEl, anchor] = useState<HTMLSpanElement | null>(null);
  const [state, setState] = useState<{ host: HTMLElement; back: HTMLElement | null } | null>(null);
  const show = useCallback(
    (back?: HTMLElement | null) => {
      const host = anchorEl?.closest<HTMLElement>("[data-slot=dialog-content]") ?? document.body;
      // Focus goes back to what opened it, else to the card itself.
      setState({ host, back: back ?? (host === document.body ? null : host) });
    },
    [anchorEl],
  );
  const hide = useCallback(() => setState(null), []);
  return { anchor, host: state?.host ?? null, back: state?.back ?? null, show, hide };
}
