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

import { FieldSelect } from "@/components/ui/field-select";
import { readTableFile, SpreadsheetError } from "@/lib/finance/import/sheet";

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

/** One CSV field, quoted when it has to be. */
function csvField(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The chosen file as the CSV the import reads: a workbook or TSV is read
 * here and written out as CSV, and a session picked on the page fills a
 * `session` column on every row the sheet left without one.
 */
async function asCsv(file: File, session: string | null): Promise<File> {
  const sheets = readTableFile(file.name, new Uint8Array(await file.arrayBuffer()));
  const rows = (sheets.find((x) => !x.hidden) ?? sheets[0])?.rows ?? [];
  const [header = [], ...body] = rows;
  let head = header.map((h) => h.trim());
  let lines = body;
  if (session) {
    const at = head.findIndex((h) => h.toLowerCase() === "session");
    if (at === -1) {
      head = ["session", ...head];
      lines = body.map((r) => [session, ...r]);
    } else {
      lines = body.map((r) => r.map((cell, i) => (i === at && !cell.trim() ? session : cell)));
    }
  }
  const text = [head, ...lines].map((r) => r.map(csvField).join(",")).join("\r\n");
  return new File([text], file.name.replace(/\.[^.]+$/, "") + ".csv", { type: "text/csv" });
}

/** A CSV column name as a header: "checked_in_at" reads "Checked in at". */
function columnLabel(key: string): string {
  const words = key.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Choose a sheet (CSV, TSV or Excel) and its preview appears at once
 * (nothing saved); then Import. For attendance, the session can be picked
 * here once instead of being a column in the file. The file is sent twice
 * (preview, then commit) and never stored on the server.
 */
export function CsvImportForm({
  uploadUrl,
  backHref,
  backLabel = "the table",
  sessions,
}: {
  uploadUrl: string;
  backHref: string;
  backLabel?: string;
  /** Attendance: recent sessions, to pick the one the whole sheet is for. */
  sessions?: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [session, setSession] = useState<string>("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState(false);

  // A new file, or a different session, previews by itself (from their own onChange).
  const send = async (mode: "preview" | "commit", f = file, chosen = session) => {
    if (!f) return;
    setBusy(true);
    try {
      let upload: File;
      try {
        upload = await asCsv(f, chosen || null);
      } catch (e) {
        setPreview({
          error:
            e instanceof SpreadsheetError ? e.message : "That file couldn't be read as a sheet.",
        });
        return;
      }
      const body = new FormData();
      body.set("file", upload);
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
  const columns = preview?.sample?.[0] ? Object.keys(preview.sample[0]) : [];

  return (
    <Card>
      <CardContent className="space-y-5">
        {sessions && sessions.length > 0 && (
          <div className="grid gap-1.5">
            <Label htmlFor="csv-session">Session</Label>
            <FieldSelect
              id="csv-session"
              value={session}
              onChange={(e) => {
                setSession(e.target.value);
                void send("preview", file, e.target.value);
              }}
              className="w-full"
            >
              <option value="">From the file&apos;s session column</option>
              {sessions.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </FieldSelect>
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="csv-file">File</Label>
          <input
            id="csv-file"
            type="file"
            accept=".csv,.tsv,.xlsx,.xlsm,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            aria-label="File"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              setPreview(null);
              if (f) void send("preview", f);
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
        ) : (
          <Button disabled={!ready || busy} onClick={() => send("commit")}>
            {busy ? "Reading" : ready ? `Import ${preview?.valid} rows` : "Import"}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
