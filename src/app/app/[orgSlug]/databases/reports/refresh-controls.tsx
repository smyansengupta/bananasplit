"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { useReportsFrame } from "@/components/reports/reports-frame";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { refreshReports } from "./actions";

/** Drops the org's cached reports and re-renders the page (Server Action). */
export function RefreshButton({ organizationId }: { organizationId: string }) {
  const { startTransition, pending } = useReportsFrame();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="lg"
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
        Refresh
      </Button>
      <span role="status" aria-live="polite" className="text-muted-foreground text-xs">
        {error}
      </span>
    </div>
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
