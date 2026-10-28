"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "@/components/icons";

import { useReportsFrame } from "@/components/reports/reports-frame";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { refreshReports } from "./actions";

/**
 * Drops the org's cached reports and re-renders the page (Server Action):
 * one small icon button beside the range; a failure shows next to it.
 */
export function RefreshButton({ organizationId }: { organizationId: string }) {
  const { startTransition, pending } = useReportsFrame();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        aria-label="Refresh reports"
        title="Refresh reports"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await refreshReports(organizationId);
            if (!result.ok) setError(result.error);
          });
        }}
      >
        <RefreshCw className={cn(pending && "animate-spin")} aria-hidden="true" />
      </Button>
      <span
        role="status"
        aria-live="polite"
        className={cn("text-destructive text-xs", !error && "sr-only")}
      >
        {error}
      </span>
    </>
  );
}

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
