"use client";

import { ArrowRight, Check, Loader2, RotateCcw, Upload } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { undoFinanceImport } from "@/app/app/[orgSlug]/finance/import-actions";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toaster";
import { formatCents } from "@/lib/finance/money";
import { cn } from "@/lib/utils";

import { ImportPanel } from "./panel";

/** What an import did, for the last screen (and the setup guide). */
export type ImportSummary =
  | {
      kind: "transactions";
      batch: string;
      created: number;
      skipped: { index: number; reason: string }[];
      periods: { label: string; created: boolean; count: number }[];
      categoriesCreated: string[];
      inCents: number;
      outCents: number;
      /** It stopped partway; what went in can still be undone. */
      partial?: boolean;
    }
  | { kind: "budget"; periodLabel: string; updated: number; created: number; totalCents: number };

export function ImportDone({
  orgId,
  orgSlug,
  summary,
  embedded,
  onAnother,
}: {
  orgId: string;
  orgSlug: string;
  summary: ImportSummary;
  embedded?: boolean;
  onAnother: () => void;
}) {
  const router = useRouter();
  const [undone, setUndone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmElement, confirm] = useConfirm();
  const base = `/app/${orgSlug}/finance`;

  async function undo() {
    if (summary.kind !== "transactions") return;
    const ok = await confirm({
      title: `Take out the ${summary.created.toLocaleString()} imported transactions?`,
      description:
        "They're deleted the usual way (you can still see them under Show deleted). Budget years and categories the import added stay.",
      confirmLabel: "Undo import",
    });
    if (!ok) return;
    setBusy(true);
    const res = await undoFinanceImport(orgId, summary.batch);
    setBusy(false);
    if (res.error) {
      toast({ title: "Couldn't undo the import", description: res.error, tone: "error" });
      return;
    }
    setUndone(true);
    router.refresh();
    toast({ title: `Removed ${res.removed ?? 0} imported transactions`, tone: "success" });
  }

  return (
    <div className="space-y-4.5">
      {confirmElement}
      <ImportPanel embedded={embedded}>
        <div className="flex items-start gap-4">
          {/* Filled circle: done. An undone import goes back to a plain circle. */}
          <span
            aria-hidden="true"
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-full",
              undone
                ? "bg-muted text-muted-foreground"
                : "bg-block-goal text-block-goal-foreground",
            )}
          >
            {undone ? <RotateCcw className="size-5" /> : <Check className="size-5 stroke-[2.5]" />}
          </span>
          <div className="min-w-0 space-y-2 pt-1">
            {summary.kind === "transactions" ? (
              <>
                <h2 className="heading text-[17px]">
                  {undone
                    ? "Import undone"
                    : `${summary.partial ? "Partly imported" : "Imported"}: ${summary.created.toLocaleString()} transaction${summary.created === 1 ? "" : "s"}`}
                </h2>
                {!undone && (
                  <ul className="text-muted-foreground space-y-1 text-sm">
                    <li className="figure">
                      {formatCents(summary.inCents)} in and {formatCents(summary.outCents)} out
                    </li>
                    {summary.periods.map((p) => (
                      <li key={p.label}>
                        {p.count.toLocaleString()} into {p.label}
                        {p.created ? " (a new budget year)" : ""}
                      </li>
                    ))}
                    {summary.categoriesCreated.length > 0 && (
                      <li>
                        New categories: {summary.categoriesCreated.slice(0, 12).join(", ")}
                        {summary.categoriesCreated.length > 12 ? "…" : ""}
                      </li>
                    )}
                    {summary.skipped.length > 0 && (
                      <li>
                        {summary.skipped.length} left out: {summary.skipped[0].reason}
                        {summary.skipped.length > 1 ? " (and others)" : ""}
                      </li>
                    )}
                  </ul>
                )}
              </>
            ) : (
              <>
                <h2 className="heading text-[17px]">Budget saved for {summary.periodLabel}</h2>
                <p className="text-muted-foreground figure text-sm">
                  {summary.created} new categor{summary.created === 1 ? "y" : "ies"},{" "}
                  {summary.updated} updated · {formatCents(summary.totalCents)} budgeted.
                </p>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 sm:pl-15">
          {/* The dashboard is a Finance tab; the next step is what was imported. */}
          {!embedded && (
            <Button asChild>
              <Link href={summary.kind === "budget" ? `${base}/budget` : `${base}/transactions`}>
                {summary.kind === "budget" ? "Open the budget" : "See the transactions"}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onAnother}>
            <Upload aria-hidden="true" />
            Import another file
          </Button>
          {summary.kind === "transactions" && !undone && summary.created > 0 && (
            <Button type="button" variant="ghost" onClick={() => void undo()} disabled={busy}>
              {busy ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <RotateCcw aria-hidden="true" />
              )}
              Undo this import
            </Button>
          )}
        </div>
      </ImportPanel>
    </div>
  );
}
