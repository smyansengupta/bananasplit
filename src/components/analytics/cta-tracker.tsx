"use client";

import { track } from "@vercel/analytics";
import { useEffect } from "react";

import { FUNNEL_EVENTS } from "@/lib/analytics/events";

/**
 * Records a click on any element marked `data-cta="<name>"` (with an
 * optional `data-cta-location`), once for the whole page, so the marketing
 * pages' links stay server components. Mounted by MarketingShell.
 */
export function CtaTracker() {
  useEffect(() => {
    function onClick(event: MouseEvent) {
      const target = (event.target as Element | null)?.closest<HTMLElement>("[data-cta]");
      if (!target) return;
      track(FUNNEL_EVENTS.ctaClicked, {
        cta: target.dataset.cta ?? "unknown",
        location: target.dataset.ctaLocation ?? "unknown",
        page: window.location.pathname,
      });
    }
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);
  return null;
}
