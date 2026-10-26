"use client";

import { Download } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { SettingsCard, SettingsStatus } from "../settings-card";
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

const STATUS_VARIANT: Record<string, "success" | "destructive" | "info" | "secondary"> = {
  PENDING: "secondary",
  RUNNING: "info",
  READY: "success",
  FAILED: "destructive",
  EXPIRED: "secondary",
};

export function ExportCard({
  orgId,
  orgSlug,
  exports,
  expiryDays,
  personal = false,
}: {
  orgId: string;
  orgSlug: string;
  exports: ExportRow[];
  expiryDays: number;
  /** A Personal space: only you can download it, and there's no org chart. */
  personal?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  return (
    <SettingsCard
      title="Export all data"
      description={
        personal
          ? `A zip of your Personal tasks, calendar, polls and event pages, with their RSVPs and answers (JSON lines and CSV). It is prepared in the background and you get a notification when it is ready. Only you can download it, for ${expiryDays} days. One export per day.`
          : `A zip of every table (JSON lines and CSV), uploaded receipts and org chart files. It is prepared in the background and you get a notification when it is ready. Only a signed-in owner can download it, for ${expiryDays} days. Integration keys are never included. One export per day.`
      }
      status={message && <SettingsStatus status={message} />}
      footer={
        <Button
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
      }
    >
      {exports.length > 0 && (
        <ul className="divide-border/70 divide-y text-sm">
          {exports.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
            >
              <span className="min-w-0">
                <span className="font-semibold tabular-nums">
                  {fmt.format(new Date(e.createdAt))}
                </span>
                <span className="text-muted-foreground">
                  {e.requestedByName ? ` · ${e.requestedByName}` : ""}
                  {e.downloadCount > 0 ? ` · downloaded ${e.downloadCount}×` : ""}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <Badge variant={STATUS_VARIANT[e.status] ?? "secondary"}>
                  {STATUS[e.status] ?? e.status}
                </Badge>
                {e.status === "READY" && (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/app/${orgSlug}/settings/danger/exports/${e.id}`}>
                      <Download data-icon="inline-start" aria-hidden="true" />
                      Download
                    </Link>
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}
