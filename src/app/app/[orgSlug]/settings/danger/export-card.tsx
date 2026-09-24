"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { requestExportAction } from "./actions";

export interface ExportRow {
  id: string;
  status: string;
  createdAt: string;
  expiresAt: string | null;
  downloadCount: number;
  requestedByName: string | null;
}

const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

const STATUS: Record<string, string> = {
  PENDING: "Queued",
  RUNNING: "Preparing",
  READY: "Ready",
  FAILED: "Failed",
  EXPIRED: "Expired",
};

export function ExportCard({
  orgId,
  orgSlug,
  exports,
  expiryDays,
}: {
  orgId: string;
  orgSlug: string;
  exports: ExportRow[];
  expiryDays: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  return (
    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="export-heading">
      <div>
        <h2 id="export-heading" className="font-medium">
          Export all data
        </h2>
        <p className="text-muted-foreground text-sm">
          A zip of every table (JSON lines and CSV), uploaded receipts and org chart files. It is
          prepared in the background and you get a notification when it is ready. Only a signed-in
          owner can download it, for {expiryDays} days. Integration keys are never included. One
          export per day.
        </p>
      </div>
      <Button
        variant="outline"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setMessage(null);
            const result = await requestExportAction(orgId);
            if (result.error) setMessage({ tone: "error", text: result.error });
            else {
              setMessage({
                tone: "ok",
                text: "Export requested. You'll be notified when it's ready.",
              });
              router.refresh();
            }
          })
        }
      >
        {isPending ? "Requesting…" : "Export all data"}
      </Button>
      {message && (
        <p
          role="status"
          className={message.tone === "error" ? "text-destructive text-sm" : "text-sm"}
        >
          {message.text}
        </p>
      )}
      {exports.length > 0 && (
        <ul className="divide-y rounded-md border text-sm">
          {exports.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <span>
                {fmt.format(new Date(e.createdAt))}
                {e.requestedByName ? ` · ${e.requestedByName}` : ""}
                {e.downloadCount > 0 ? ` · downloaded ${e.downloadCount}×` : ""}
              </span>
              <span className="flex items-center gap-2">
                <Badge variant={e.status === "READY" ? "default" : "secondary"}>
                  {STATUS[e.status] ?? e.status}
                </Badge>
                {e.status === "READY" && (
                  <Link
                    className="underline underline-offset-4"
                    href={`/app/${orgSlug}/settings/danger/exports/${e.id}`}
                  >
                    Download
                  </Link>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
