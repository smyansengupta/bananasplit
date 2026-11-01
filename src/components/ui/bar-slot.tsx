"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * One bar for a section and its pages: the section's tabs on the left (from
 * its layout), and whatever the page on screen puts there with <InBar> on
 * the right (Finance's Customize, the transactions' Filters and search),
 * so a page's controls sit on the tabs' row instead of a row of their own.
 */

const SlotContext = createContext<{ inside: boolean; slot: HTMLElement | null }>({
  inside: false,
  slot: null,
});

export function BarSlotProvider({ bar, children }: { bar: ReactNode; children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <SlotContext.Provider value={{ inside: true, slot }}>
      <div
        className={
          bar
            ? "flex flex-wrap items-center gap-2"
            : "flex flex-wrap items-center gap-2 has-[>div:empty]:hidden"
        }
      >
        {bar}
        <div
          ref={setSlot}
          className="ms-auto flex min-w-0 flex-wrap items-center justify-end gap-2 empty:hidden"
        />
      </div>
      {children}
    </SlotContext.Provider>
  );
}

/** Puts its children on the section's bar (BarSlotProvider), or in place without one. */
export function InBar({ children }: { children: ReactNode }) {
  const { inside, slot } = useContext(SlotContext);
  if (!inside) return <>{children}</>;
  return slot ? createPortal(children, slot) : null;
}
