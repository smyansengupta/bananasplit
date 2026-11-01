"use client";

import { useEffect, useState } from "react";

import { pill } from "@/components/brand/pill";
import { cn } from "@/lib/utils";

/**
 * On a phone, a glass bar at the bottom of the RSVP page (the guide's phone
 * tab bar material) that takes you to the sign-up form. It shows only while
 * neither the hero's Register button (#hero-cta) nor the form (#register) is
 * on screen, so there is always exactly one way to sign up in view.
 */
export function StickyRegister({ label, detail }: { label: string; detail: string }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const targets = ["register"]
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0) return;
    const visible = new Set<Element>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      }
      setShown(visible.size === 0);
    });
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div
      aria-hidden={!shown}
      className={cn(
        "fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-40 transition-[opacity,translate] duration-500 ease-(--ease-spring) motion-reduce:transition-none md:hidden",
        shown ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0",
      )}
    >
      <div className="glass flex h-16 items-center justify-between gap-3 rounded-full pr-2 pl-5">
        <span className="min-w-0 truncate text-[14px] font-semibold">{detail}</span>
        <a
          href="#register"
          tabIndex={shown ? undefined : -1}
          className={cn(
            pill({ size: "md" }),
            "bg-chrome-foreground text-chrome hover:bg-chrome-foreground/90 hover:text-chrome flex-none",
          )}
        >
          {label}
        </a>
      </div>
    </div>
  );
}
