"use client";

import { CheckCircle2, Loader2, RotateCcw, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { undoFinanceImport } from "@/app/app/[orgSlug]/finance/import-actions";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toaster";
import { formatCents } from "@/lib/finance/money";

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
      description: "They're deleted the usual way (you can still see them under Show deleted). Budget years and categories the import added stay.",
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
    <div className="space-y-5">
      {confirmElement}
      <div className="flex items-start gap-3 rounded-xl border p-5">
        <CheckCircle2 className="text-success mt-0.5 size-6 shrink-0" aria-hidden="true" />
        <div className="min-w-0 space-y-2">
          {summary.kind === "transactions" ? (
            <>
              <h2 className="text-lg font-semibold">
                {undone
                  ? "Import undone"
                  : `${summary.partial ? "Partly imported" : "Imported"}: ${summary.created.toLocaleString()} transaction${summary.created === 1 ? "" : "s"}`}
              </h2>
              {!undone && (
                <ul className="text-muted-foreground space-y-1 text-sm">
                  <li>
                    {formatCents(summary.inCents)} in and {formatCents(summary.outCents)} out
                  </li>
                  {summary.periods.map((p) => (
                    <li key={p.label}>
                      {p.count.toLocaleString()} into {p.label}
                      {p.created ? " (a new budget year)" : ""}
                    </li>
                  ))}
                  {summary.categoriesCreated.length > 0 && (
                    <li>New categories: {summary.categoriesCreated.slice(0, 12).join(", ")}
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
              <h2 className="text-lg font-semibold">Budget saved for {summary.periodLabel}</h2>
              <p className="text-muted-foreground text-sm">
                {summary.created} new categor{summary.created === 1 ? "y" : "ies"}, {summary.updated} updated ·{" "}
                {formatCents(summary.totalCents)} budgeted.
              </p>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {summary.kind === "transactions" && !undone && summary.created > 0 && (
          <Button type="button" variant="outline" onClick={() => void undo()} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="size-4" aria-hidden="true" />}
            Undo this import
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onAnother}>
          <Upload className="size-4" aria-hidden="true" />
          Import another file
        </Button>
        {!embedded && (
          <>
            <Button asChild variant="ghost">
              <Link href={summary.kind === "budget" ? `${base}/budget` : `${base}/transactions`}>
                {summary.kind === "budget" ? "Open the budget" : "See the transactions"}
              </Link>
            </Button>
            <Button asChild>
              <Link href={base}>Go to the dashboard</Link>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
