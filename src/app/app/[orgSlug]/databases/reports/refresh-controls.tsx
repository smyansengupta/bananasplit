"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useReportsFrame } from "@/components/reports/reports-frame";

/**
 * Re-renders the page every OrgSettings.reportsRefreshSeconds while the tab
 * is visible, so an open dashboard follows the cache's own refresh interval.
 */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  const { startTransition } = useReportsFrame();

  useEffect(() => {
    const ms = Math.max(30, seconds) * 1000;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") startTransition(() => router.refresh());
    }, ms);
    return () => window.clearInterval(timer);
  }, [router, seconds, startTransition]);

  return null;
}
