"use client";

import { Loader2, RefreshCw, RotateCcw, Settings2 } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { syncNowAction } from "@/app/app/[orgSlug]/databases/actions";
import { ItemMenu } from "@/components/item-menu";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { notice } from "./styles";
import { TableFrame } from "./table-frame";

export interface SyncPanelStream {
  stream: string;
  label: string;
  lastSynced: string | null;
  rowsUpserted: number;
  lastError: string | null;
  detail: string | null;
}

/**
 * Website sync status (ADMIN+). The sync runs by itself every few minutes,
 * so "Sync now", "Full reconcile" and the connection's Admin panel page sit
 * in the "…" menu. Sync now only enqueues the job and kicks the drain; the
 * numbers update when the job finishes (refresh the page).
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
  const router = useRouter();
  const [confirmEl, confirm] = useConfirm();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const sync = async (full: boolean) => {
    if (
      full &&
      !(await confirm({
        title: "Run a full reconcile?",
        description:
          "Everything is read again from the website, and rows it no longer has are removed here.",
        confirmLabel: "Full reconcile",
      }))
    )
      return;
    setError(null);
    start(async () => {
      const result = await syncNowAction(organizationId, full);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  };

  return (
    <Card aria-labelledby="sync-heading" role="region">
      {confirmEl}
      <CardHeader>
        <CardTitle>
          <h2 id="sync-heading" className="flex flex-wrap items-center gap-2">
            Website data sync
            <Badge
              variant={
                status === "CONNECTED"
                  ? "success"
                  : status === "ERROR"
                    ? "destructive"
                    : "secondary"
              }
            >
              {status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ")}
            </Badge>
            {pending && (
              <Loader2 className="text-muted-foreground size-4 animate-spin" aria-label="Syncing" />
            )}
          </h2>
        </CardTitle>
        <CardDescription>
          {endpoint
            ? `Reads ${endpoint} through the suite export.`
            : (configError ?? "Not configured.")}
        </CardDescription>
        <CardAction>
          <ItemMenu
            label="Website sync actions"
            className="border-input"
            items={[
              {
                label: "Sync now",
                icon: RefreshCw,
                onSelect: () => void sync(false),
                disabled: pending,
              },
              {
                label: "Full reconcile…",
                icon: RotateCcw,
                onSelect: () => void sync(true),
                disabled: pending,
              },
              {
                label: "Admin panel › Integrations",
                icon: Settings2,
                href: settingsHref,
                separated: true,
              },
            ]}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <p role="alert" className={notice.error}>
            {error}
          </p>
        )}
        {lastError && (
          <p role="status" className={notice.error}>
            Last error: {lastError}
          </p>
        )}
        <TableFrame bare maxHeight="none">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stream</TableHead>
                <TableHead>Last sync</TableHead>
                <TableHead className="text-right tabular-nums">Rows written</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {streams.map((s) => (
                <TableRow key={s.stream}>
                  <TableCell className="font-medium">{s.label}</TableCell>
                  <TableCell className="tabular-nums">
                    {s.lastSynced ?? <span className="text-muted-foreground">Never</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.rowsUpserted.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-normal">
                    {s.lastError ? (
                      <span className="text-tint-danger-foreground">{s.lastError}</span>
                    ) : (
                      (s.detail ?? "")
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableFrame>
      </CardContent>
    </Card>
  );
}
