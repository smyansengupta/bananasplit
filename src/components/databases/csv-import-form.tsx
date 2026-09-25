"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

interface PreviewResult {
  total?: number;
  valid?: number;
  issues?: { line: number; message: string }[];
  sample?: Record<string, string | number>[];
  committed?: { created: number; skipped: number };
  error?: string;
}

/**
 * Upload a CSV, preview it (nothing saved), then import it. The file is sent
 * twice (preview, then commit) and never stored on the server.
 */
export function CsvImportForm({ uploadUrl, backHref }: { uploadUrl: string; backHref: string }) {
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

  const columns = preview?.sample?.[0] ? Object.keys(preview.sample[0]) : [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".csv,text/csv"
          aria-label="CSV file"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setPreview(null);
          }}
          className="text-sm"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!file || busy}
          onClick={() => send("preview")}
        >
          Preview
        </Button>
        {preview && !preview.committed && !preview.error && (preview.valid ?? 0) > 0 && (
          <Button size="sm" disabled={busy} onClick={() => send("commit")}>
            Import {preview.valid} rows
          </Button>
        )}
      </div>

      {preview?.error && (
        <p role="alert" className="text-destructive text-sm">
          {preview.error}
        </p>
      )}
      {preview?.committed && (
        <p className="text-success text-sm">
          Imported {preview.committed.created} rows ({preview.committed.skipped} skipped as
          duplicates or problems).{" "}
          <a className="underline underline-offset-2" href={backHref}>
            Back to the table
          </a>
        </p>
      )}
      {preview && !preview.committed && !preview.error && (
        <p className="text-sm">
          {preview.valid ?? 0} of {preview.total ?? 0} rows are ready to import.
        </p>
      )}
      {preview?.issues && preview.issues.length > 0 && (
        <div className="border-warning/40 bg-warning/10 rounded-md border p-3 text-sm">
          <p className="font-medium">Rows that will be skipped</p>
          <ul className="mt-1 max-h-48 list-disc overflow-y-auto pl-5 text-xs">
            {preview.issues.map((i) => (
              <li key={`${i.line}-${i.message}`}>
                Line {i.line}: {i.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {columns.length > 0 && !preview?.committed && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left">
              <tr>
                {columns.map((c) => (
                  <th key={c} className="px-2 py-1 font-medium capitalize">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview?.sample?.map((row) => (
                <tr key={String(row.line)} className="border-t">
                  {columns.map((c) => (
                    <td key={c} className="px-2 py-1">
                      {String(row[c] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
