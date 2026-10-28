"use client";

import { CircleAlert } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { StepPills } from "./step-pills";
import { fileInputClass, notice } from "./styles";
import { TableFrame } from "./table-frame";

interface PreviewResult {
  total?: number;
  valid?: number;
  issues?: { line: number; message: string }[];
  sample?: Record<string, string | number>[];
  committed?: { created: number; skipped: number };
  error?: string;
}

const STEPS = ["Choose a file", "Preview", "Import"] as const;

/** A CSV column name as a header: "checked_in_at" reads "Checked in at". */
function columnLabel(key: string): string {
  const words = key.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Upload a CSV, preview it (nothing saved), then import it. The file is sent
 * twice (preview, then commit) and never stored on the server. The steps
 * show as pills; the card's one primary action is the next step.
 */
export function CsvImportForm({
  uploadUrl,
  backHref,
  backLabel = "the table",
}: {
  uploadUrl: string;
  backHref: string;
  backLabel?: string;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async (mode: "preview" | "commit") => {
    if (!file) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("mode", mode);
      const res = await fetch(uploadUrl, { method: "POST", body });
      const data = (await res
        .json()
        .catch(() => ({ error: "The server did not answer." }))) as PreviewResult;
      setPreview(data);
      if (mode === "commit" && data.committed) router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const ready = Boolean(
    preview && !preview.committed && !preview.error && (preview.valid ?? 0) > 0,
  );
  const step = preview?.committed ? STEPS.length : ready ? 2 : file ? 1 : 0;
  const columns = preview?.sample?.[0] ? Object.keys(preview.sample[0]) : [];

  return (
    <Card>
      <CardContent className="space-y-5">
        <StepPills steps={STEPS} current={step} label="Import steps" />

        <div className="grid gap-1.5">
          <Label htmlFor="csv-file">CSV file</Label>
          <input
            id="csv-file"
            type="file"
            accept=".csv,text/csv"
            aria-label="CSV file"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
            }}
            className={fileInputClass}
          />
        </div>

        {preview?.error && (
          <p role="alert" className={notice.error}>
            {preview.error}
          </p>
        )}
        {preview?.committed && (
          <p role="status" className={notice.success}>
            Imported {preview.committed.created} rows ({preview.committed.skipped} skipped as
            duplicates or problems).
          </p>
        )}
        {preview && !preview.committed && !preview.error && (
          <p className="text-sm tabular-nums" role="status">
            <span className="font-semibold">{preview.valid ?? 0}</span> of {preview.total ?? 0} rows
            are ready to import.
          </p>
        )}
        {preview?.issues && preview.issues.length > 0 && (
          <div className="bg-muted/60 rounded-tile space-y-1.5 p-4 text-sm">
            <p className="flex items-center gap-2 font-semibold">
              <CircleAlert className="text-warning size-4 shrink-0" aria-hidden="true" />
              Rows that will be skipped
            </p>
            <ul className="text-muted-foreground max-h-48 list-disc space-y-0.5 overflow-y-auto pl-9 text-[13px]">
              {preview.issues.map((i) => (
                <li key={`${i.line}-${i.message}`}>
                  Line {i.line}: {i.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {columns.length > 0 && !preview?.committed && (
          <TableFrame bare maxHeight="24rem">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((c) => (
                    <TableHead
                      key={c}
                      className={c === "line" ? "text-right tabular-nums" : undefined}
                    >
                      {columnLabel(c)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview?.sample?.map((row) => (
                  <TableRow key={String(row.line)}>
                    {columns.map((c) => (
                      <TableCell
                        key={c}
                        className={
                          typeof row[c] === "number" ? "text-right tabular-nums" : undefined
                        }
                      >
                        {String(row[c] ?? "")}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableFrame>
        )}
      </CardContent>
      <CardFooter className="flex-wrap justify-end gap-2">
        {preview?.committed ? (
          <Button asChild>
            <Link href={backHref}>Back to {backLabel}</Link>
          </Button>
        ) : ready ? (
          <>
            <Button variant="outline" disabled={!file || busy} onClick={() => send("preview")}>
              Preview again
            </Button>
            <Button disabled={busy} onClick={() => send("commit")}>
              {busy ? "Importing…" : `Import ${preview?.valid} rows`}
            </Button>
          </>
        ) : (
          <Button disabled={!file || busy} onClick={() => send("preview")}>
            {busy ? "Reading…" : "Preview"}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
