"use client";

import {
  ClipboardPaste,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { useAiConnections } from "@/components/ai/connection-picker";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { DocumentRead } from "@/lib/ai/finance-sheet";
import {
  applyBudgetMapping,
  applyMapping,
  guessMapping,
  labelKey,
  type BudgetLine,
  type ImportRow,
  type SheetMapping,
  type ValueLabel,
} from "@/lib/finance/import/mapping";
import type { PeriodLike } from "@/lib/finance/import/plan";
import {
  isDocumentFile,
  readPastedTable,
  readTableFile,
  SpreadsheetError,
  type SheetData,
} from "@/lib/finance/import/sheet";
import { cn } from "@/lib/utils";

import { ImportColumns } from "./import-columns";
import { ImportDone, type ImportSummary } from "./import-done";
import { BudgetReview, ImportReview } from "./import-review";

/**
 * Bring past money records into Finance: a spreadsheet or bank export (read
 * here in the browser, so the file never leaves the computer), rows pasted
 * from Google Sheets or Excel, or a PDF or photo the club's AI model reads.
 * Columns are guessed and can be fixed by hand or by the AI; every row is
 * reviewed before anything is saved, and an import can be undone.
 */

export interface FinanceImportProps {
  orgId: string;
  orgSlug: string;
  /** The club's local date, YYYY-MM-DD. */
  today: string;
  periods: PeriodLike[];
  categories: { name: string; budgetPeriodId: string }[];
  /** Inside the setup guide: no page heading, and a way back to the guide when done. */
  embedded?: boolean;
  onFinished?: (summary: ImportSummary) => void;
}

type Stage =
  | { step: "source" }
  | { step: "reading"; what: string }
  | { step: "columns"; sheets: SheetData[]; sheetIndex: number; mapping: SheetMapping; labels: Map<string, ValueLabel> }
  | { step: "review"; rows: ImportRow[]; back: Stage | null }
  | { step: "budget"; lines: BudgetLine[]; back: Stage | null }
  | { step: "done"; summary: ImportSummary };

const ACCEPT = ".csv,.tsv,.txt,.xlsx,.xlsm,.xls,.pdf,.png,.jpg,.jpeg,.webp,.gif,text/csv,application/pdf,image/*";
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;

const TEMPLATE = [
  "Date,Description,Amount,Category,Paid to / from",
  "2026-09-05,Pizza for the kickoff meeting,-84.50,Food,Domino's",
  "2026-09-08,Member dues (12 people),240.00,Dues,Members",
  "2026-09-12,Poster printing,-35.20,Marketing,FedEx Office",
  "2026-09-20,Sponsorship from Acme,500.00,Sponsorships,Acme Corp",
].join("\n");

export const STEPS = ["Choose", "Columns", "Review", "Done"] as const;

function stepIndex(stage: Stage): number {
  if (stage.step === "source" || stage.step === "reading") return 0;
  if (stage.step === "columns") return 1;
  if (stage.step === "done") return 3;
  return 2;
}

export function FinanceImport(props: FinanceImportProps) {
  const { orgId, orgSlug, today } = props;
  const [stage, setStage] = useState<Stage>({ step: "source" });
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [dragging, setDragging] = useState(false);
  const [readBy, setReadBy] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const ai = useAiConnections(orgId, true);

  const toReview = useCallback(
    (sheets: SheetData[], sheetIndex: number, mapping: SheetMapping, labels: Map<string, ValueLabel>, back: Stage) => {
      const sheet = sheets[sheetIndex];
      if (mapping.kind === "budget") {
        setStage({ step: "budget", lines: applyBudgetMapping(sheet, mapping), back });
      } else {
        setStage({ step: "review", rows: applyMapping(sheet, mapping, { today, labels }), back });
      }
    },
    [today],
  );

  function openTable(sheets: SheetData[]) {
    const visible = sheets.findIndex((s) => !s.hidden);
    const first = visible >= 0 ? visible : 0;
    const best = sheets.reduce((b, s, i) => (!s.hidden && s.rows.length > sheets[b].rows.length ? i : b), first);
    setStage({ step: "columns", sheets, sheetIndex: best, mapping: guessMapping(sheets[best], today), labels: new Map() });
  }

  async function readDocument(body: FormData | { mode: "text"; text: string }, what: string) {
    if (!ai.selected) {
      setError(
        ai.list && ai.list.length === 0
          ? "Reading PDFs, photos and pasted history needs an AI model. An owner or admin can connect one in Settings › Integrations, or export the data as CSV."
          : "Still checking which AI model is connected. Try again in a moment.",
      );
      return;
    }
    setStage({ step: "reading", what });
    try {
      const res = await fetch(`/api/orgs/${orgId}/ai/finance-import`, {
        method: "POST",
        ...(body instanceof FormData
          ? { body }
          : { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, connection: ai.selected.id }) }),
      });
      const json = (await res.json().catch(() => null)) as (DocumentRead & { readBy?: string; error?: string }) | null;
      if (!res.ok || !json) throw new Error(json?.error ?? "That couldn't be read. Try again.");
      setReadBy(json.readBy ?? null);
      setNotes(json.notes ?? []);
      if (json.kind === "budget") {
        setStage({ step: "budget", lines: json.budget, back: null });
      } else if (json.rows.length === 0) {
        setStage({ step: "source" });
        setError("No money records were found in that. Try a clearer file, or a CSV export.");
      } else {
        setStage({ step: "review", rows: json.rows, back: null });
      }
    } catch (e) {
      setStage({ step: "source" });
      setError(e instanceof Error ? e.message : "That couldn't be read. Try again.");
    }
  }

  async function pickFile(file: File) {
    setError(null);
    setReadBy(null);
    setNotes([]);
    setFileName(file.name);
    if (isDocumentFile(file.name)) {
      if (file.size > MAX_DOCUMENT_BYTES) {
        setError("That file is over 4 MB. Split the PDF, or export the data as CSV.");
        return;
      }
      const form = new FormData();
      form.append("file", file);
      if (ai.selected) form.append("connection", ai.selected.id);
      await readDocument(form, file.name);
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      openTable(readTableFile(file.name, bytes));
    } catch (e) {
      setError(e instanceof SpreadsheetError ? e.message : "That file couldn't be opened. Try CSV or .xlsx.");
    }
  }

  async function submitPasted() {
    setError(null);
    setReadBy(null);
    setNotes([]);
    const text = pasted.trim();
    if (!text) {
      setError("Paste some rows first.");
      return;
    }
    setFileName("Pasted rows");
    const sheet = readPastedTable(text);
    const width = sheet.rows.reduce((w, r) => Math.max(w, r.length), 0);
    if (sheet.rows.length >= 2 && width >= 2) {
      openTable([sheet]);
      return;
    }
    await readDocument({ mode: "text", text }, "your pasted text");
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "bananasplit-finance-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const current = stepIndex(stage);

  return (
    <div className="space-y-5">
      {!props.embedded && (
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" aria-label="Import steps">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span
                className={cn(
                  "grid size-5 place-items-center rounded-full border text-[11px] font-semibold",
                  i < current && "bg-primary border-primary text-primary-foreground",
                  i === current && "border-primary text-primary",
                  i > current && "text-muted-foreground",
                )}
                aria-current={i === current ? "step" : undefined}
              >
                {i + 1}
              </span>
              <span className={cn(i === current ? "font-medium" : "text-muted-foreground")}>{s}</span>
              {i < STEPS.length - 1 && <span className="bg-border h-px w-6" aria-hidden="true" />}
            </li>
          ))}
        </ol>
      )}

      {error && (
        <p role="alert" className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-3 text-sm">
          {error}
        </p>
      )}

      {stage.step === "source" && (
        <div className="space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void pickFile(file);
            }}
            className={cn(
              "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
              dragging ? "border-primary bg-primary/5" : "bg-muted/30",
            )}
          >
            <span className="bg-primary/10 text-primary grid size-12 place-items-center rounded-full">
              <FileSpreadsheet className="size-6" aria-hidden="true" />
            </span>
            <div className="space-y-1">
              <p className="font-medium">Drop a spreadsheet, a bank export, a PDF or a photo</p>
              <p className="text-muted-foreground text-sm">
                CSV, Excel (.xlsx), a Venmo or bank statement, receipts, last year&apos;s budget. Anything you kept money
                records in.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" onClick={() => input.current?.click()}>
                <Upload className="size-4" aria-hidden="true" />
                Choose a file
              </Button>
              <Button type="button" variant="outline" onClick={() => setPasting((p) => !p)} aria-expanded={pasting}>
                <ClipboardPaste className="size-4" aria-hidden="true" />
                Paste rows
              </Button>
            </div>
            <input
              ref={input}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-label="Choose a file to import"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void pickFile(file);
              }}
            />
          </div>

          {pasting && (
            <div className="space-y-2">
              <Textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                rows={8}
                placeholder={"Copy rows from Google Sheets or Excel (with the header row) and paste them here.\nOr paste a Venmo or bank history: the AI model reads it."}
                aria-label="Pasted rows"
                className="font-mono text-xs"
              />
              <div className="flex justify-end">
                <Button type="button" onClick={() => void submitPasted()} disabled={!pasted.trim()}>
                  Use these rows
                </Button>
              </div>
            </div>
          )}

          <div className="text-muted-foreground grid gap-3 text-xs sm:grid-cols-2">
            <p className="flex items-start gap-2">
              <ShieldCheck className="mt-px size-4 shrink-0" aria-hidden="true" />
              <span>
                Spreadsheets are opened here in your browser; the file isn&apos;t uploaded. You check every row, and only
                the ones you import are saved.
              </span>
            </p>
            <p className="flex items-start gap-2">
              <FileText className="mt-px size-4 shrink-0" aria-hidden="true" />
              <span>
                PDFs and photos are read by your club&apos;s AI model ({ai.selected ? ai.selected.label : "when one is connected"}).{" "}
                <button type="button" onClick={downloadTemplate} className="text-primary inline-flex items-center gap-1 underline-offset-2 hover:underline">
                  <Download className="size-3" aria-hidden="true" />
                  Download a template
                </button>
              </span>
            </p>
          </div>
        </div>
      )}

      {stage.step === "reading" && (
        <div className="flex flex-col items-center gap-3 rounded-xl border px-6 py-12 text-center" aria-live="polite">
          <Loader2 className="text-primary size-6 animate-spin" aria-hidden="true" />
          <p className="font-medium">Reading {stage.what}…</p>
          <p className="text-muted-foreground text-sm">
            {ai.selected?.label ?? "The AI model"} is listing the money records. This can take up to a minute.
          </p>
        </div>
      )}

      {stage.step === "columns" && (
        <ImportColumns
          orgId={orgId}
          orgSlug={orgSlug}
          today={today}
          fileName={fileName}
          sheets={stage.sheets}
          sheetIndex={stage.sheetIndex}
          mapping={stage.mapping}
          labels={stage.labels}
          ai={ai}
          readBy={readBy}
          notes={notes}
          onRead={(mapping, labels, by, aiNotes) => {
            setReadBy(by);
            setNotes(aiNotes);
            setStage({ ...stage, mapping: mapping ?? stage.mapping, labels: toLabelMap(labels) });
          }}
          onChange={(next) => setStage({ ...stage, ...next })}
          onBack={() => {
            setStage({ step: "source" });
            setReadBy(null);
            setNotes([]);
          }}
          onContinue={() => toReview(stage.sheets, stage.sheetIndex, stage.mapping, stage.labels, stage)}
        />
      )}

      {stage.step === "review" && (
        <ImportReview
          orgId={orgId}
          orgSlug={orgSlug}
          fileName={fileName}
          initialRows={stage.rows}
          periods={props.periods}
          categories={props.categories}
          readBy={readBy}
          notes={stage.back ? [] : notes}
          onBack={() => setStage(stage.back ?? { step: "source" })}
          onDone={(summary) => {
            setStage({ step: "done", summary });
            props.onFinished?.(summary);
          }}
        />
      )}

      {stage.step === "budget" && (
        <BudgetReview
          orgId={orgId}
          initialLines={stage.lines}
          periods={props.periods}
          readBy={readBy}
          notes={stage.back ? [] : notes}
          onBack={() => setStage(stage.back ?? { step: "source" })}
          onDone={(summary) => {
            setStage({ step: "done", summary });
            props.onFinished?.(summary);
          }}
        />
      )}

      {stage.step === "done" && (
        <ImportDone
          orgId={orgId}
          orgSlug={orgSlug}
          summary={stage.summary}
          embedded={props.embedded}
          onAnother={() => {
            setStage({ step: "source" });
            setFileName("");
            setPasted("");
            setReadBy(null);
            setNotes([]);
          }}
        />
      )}
    </div>
  );
}

function toLabelMap(labels: readonly { column: number; value: string; category: string | null; kind: ValueLabel["kind"] }[]) {
  return new Map(labels.map((l) => [labelKey(l.column, l.value), { category: l.category, kind: l.kind }]));
}

