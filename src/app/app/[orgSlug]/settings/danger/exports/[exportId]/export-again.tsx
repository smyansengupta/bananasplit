"use client";

import { Loader2 } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";

import { requestExportAction } from "../../actions";

/** A failed or expired export's one way forward: ask for a new one right here. */
export function ExportAgain({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const result = await requestExportAction(orgId);
        setBusy(false);
        if (result.error) {
          toast({ title: result.error, tone: "error" });
          return;
        }
        toast({ title: "Requested. We'll notify you.", tone: "success" });
        router.push(`/app/${orgSlug}/settings/danger`);
      }}
    >
      {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      Export again
    </Button>
  );
}

/** While an export is being prepared, re-reads the page every 15 seconds. */
export function RefreshWhilePreparing() {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => router.refresh(), 15_000);
    return () => window.clearInterval(id);
  }, [router]);
  return null;
}
