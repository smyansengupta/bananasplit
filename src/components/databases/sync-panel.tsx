"use client";

import { RefreshCw } from "lucide-react";

import { syncNowAction } from "@/app/app/[orgSlug]/databases/actions";
import { Badge } from "@/components/ui/badge";

import { ActionButton } from "./action-button";

export interface SyncPanelStream {
  stream: string;
  label: string;
  lastSynced: string | null;
  rowsUpserted: number;
  lastError: string | null;
  detail: string | null;
}

/**
 * Website sync status and "Sync now" (ADMIN+). Sync now only enqueues the
 * job and kicks the drain; the numbers update when the job finishes
 * (refresh the page).
 */
export function SyncPanel({
  organizationId,
  status,
  lastError,
  endpoint,
  configError,
  streams,
  settingsHref,
}: {
  organizationId: string;
  status: string;
  lastError: string | null;
  endpoint: string | null;
  configError: string | null;
  streams: SyncPanelStream[];
  settingsHref: string;
}) {
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="sync-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="sync-heading" className="flex items-center gap-2 text-sm font-semibold">
            Website data sync
            <Badge variant={status === "CONNECTED" ? "default" : status === "ERROR" ? "destructive" : "secondary"}>
              {status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ")}
            </Badge>
          </h2>
          <p className="text-muted-foreground text-xs">
            {endpoint ? `Reads ${endpoint} through the suite export.` : (configError ?? "Not configured.")}{" "}
            <a className="underline underline-offset-2" href={settingsHref}>
              Settings
            </a>
          </p>
        </div>
        <div className="flex gap-2">
          <ActionButton action={syncNowAction} args={[organizationId, false]}>
            <RefreshCw aria-hidden="true" />
            Sync now
          </ActionButton>
          <ActionButton
            variant="ghost"
            action={syncNowAction} args={[organizationId, true]}
            confirm="Re-read everything from the website and remove rows it no longer has?"
          >
            Full reconcile
          </ActionButton>
        </div>
      </div>
      {lastError && (
        <p role="status" className="text-destructive text-xs">
          Last error: {lastError}
        </p>
      )}
      <table className="w-full text-xs">
        <thead className="text-muted-foreground text-left">
          <tr>
            <th className="py-1 font-medium">Stream</th>
            <th className="py-1 font-medium">Last sync</th>
            <th className="py-1 text-right font-medium">Rows written</th>
            <th className="py-1 pl-3 font-medium">Notes</th>
          </tr>
        </thead>
        <tbody>
          {streams.map((s) => (
            <tr key={s.stream} className="border-t">
              <td className="py-1.5">{s.label}</td>
              <td className="py-1.5">{s.lastSynced ?? "Never"}</td>
              <td className="py-1.5 text-right tabular-nums">{s.rowsUpserted.toLocaleString()}</td>
              <td className="py-1.5 pl-3">
                {s.lastError ? <span className="text-destructive">{s.lastError}</span> : (s.detail ?? "")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
