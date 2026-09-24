"use client";

import { FileText, Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { discardDraftAction, retryParseAction } from "@/app/app/[orgSlug]/org-chart/actions";
import { Button } from "@/components/ui/button";

import { StartDraftButton } from "../start-draft-button";

/** Re-renders the server page every few seconds while `active`. */
export function AutoRefresh({ active, intervalMs = 3000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => router.refresh(), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs, router]);
  return null;
}

const STEPS: Record<string, string> = {
  PENDING: "Waiting for a worker…",
  EXTRACTING: "Reading the file…",
  PARSING: "Claude is reading the chart…",
};

/** A draft whose document is still being parsed, or whose parse failed. */
export function ParseStatus({
  orgId,
  orgSlug,
  versionId,
  parseStatus,
  parseError,
  filename,
  sourceHref,
}: {
  orgId: string;
  orgSlug: string;
  versionId: string;
  parseStatus: string;
  parseError: string | null;
  filename: string | null;
  sourceHref: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const failed = parseStatus === "FAILED";

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after: () => void) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (!result.ok) setError(result.error ?? "That didn't work.");
      else after();
    });

  return (
    <div className="mx-auto max-w-xl space-y-4 rounded-xl border p-6">
      <AutoRefresh active={!failed} />
      <div className="flex items-start gap-3">
        {failed ? (
          <TriangleAlert className="text-destructive mt-0.5 size-5 shrink-0" aria-hidden="true" />
        ) : (
          <Loader2 className="text-muted-foreground mt-0.5 size-5 shrink-0 animate-spin" aria-hidden="true" />
        )}
        <div className="min-w-0 space-y-1" role="status" aria-live="polite">
          <p className="font-medium">{failed ? "The document couldn't be read" : STEPS[parseStatus] ?? "Working…"}</p>
          {filename && (
            <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
              <FileText className="size-4" aria-hidden="true" />
              {sourceHref ? (
                <a href={sourceHref} className="truncate underline-offset-4 hover:underline">
                  {filename}
                </a>
              ) : (
                <span className="truncate">{filename}</span>
              )}
            </p>
          )}
          {failed ? (
            <p className="text-sm">{parseError ?? "Something went wrong while parsing."}</p>
          ) : (
            <p className="text-muted-foreground text-sm">
              This usually takes under two minutes. You can leave this page; the draft will be waiting here.
            </p>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {failed && (
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => run(() => retryParseAction(orgId, versionId), () => router.refresh())}
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            Try again
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(
              () => discardDraftAction(orgId, versionId),
              () => router.push(`/app/${orgSlug}/org-chart/import`),
            )
          }
        >
          {failed ? "Discard" : "Cancel and discard"}
        </Button>
        {failed && (
          <StartDraftButton orgId={orgId} orgSlug={orgSlug} from="blank" variant="ghost">
            Build it by hand instead
          </StartDraftButton>
        )}
      </div>
    </div>
  );
}
