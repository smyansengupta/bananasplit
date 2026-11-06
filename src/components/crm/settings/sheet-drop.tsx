"use client";

import { useRef, useState, type DragEvent } from "react";

import { ArrowRight, FileSpreadsheet, Upload } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { builtinFields } from "@/lib/crm/fields";
import { ACTIVITY_TARGET_LABELS, type Mapping } from "@/lib/crm/mapping";
import { cn } from "@/lib/utils";

/**
 * A spreadsheet dropped for people (CRM settings > Connections, and "Get
 * your CRM started"): the file goes to /crm/import/upload, which keeps its
 * rows and suggests where each column goes; this shows those matches. The
 * caller starts the import (startImportAction) with `mapping`. Changing a
 * match is the full importer's job (/crm/import).
 */

export interface DroppedSheet {
  importId: string;
  fileName: string;
  total: number;
  headers: string[];
  mapping: Mapping;
}

/** "Email", "A note on their timeline", "A field of your own". */
export function targetLabel(target: string): string {
  if (target.startsWith("custom:")) return "A field of your own";
  if (target.startsWith("activity.")) {
    const label = ACTIVITY_TARGET_LABELS[target as keyof typeof ACTIVITY_TARGET_LABELS];
    return target === "activity.body" ? "A note on their timeline" : (label ?? "Their timeline");
  }
  return builtinFields("person").find((f) => f.key === target)?.label ?? target;
}

const ACCEPT = ".csv,.tsv,.txt,.xlsx,.xlsm,.vcf,.vcard";

/**
 * Taking a file in: `zone` makes anything a drop target, `pick` opens the
 * file picker, `input` is the hidden field to render with them. The rows go
 * to /crm/import/upload and come back as a DroppedSheet.
 */
export function useSheetUpload(orgSlug: string, onDropped: (sheet: DroppedSheet) => void) {
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const send = async (file: File) => {
    setBusy(true);
    const body = new FormData();
    body.set("file", file);
    body.set("object", "person");
    const res = await fetch(`/app/${orgSlug}/crm/import/upload`, { method: "POST", body }).catch(
      () => null,
    );
    const data = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res || !res.ok || !data || data.error) {
      toast({ title: data?.error ?? "That file couldn't be read.", tone: "error" });
      return;
    }
    const log = data.log as {
      id: string;
      fileName: string;
      total: number;
      headers: string[];
      mapping: Mapping;
    };
    onDropped({
      importId: log.id,
      fileName: log.fileName,
      total: log.total,
      headers: log.headers,
      mapping: log.mapping,
    });
  };
  return {
    busy,
    over,
    pick: () => ref.current?.click(),
    zone: {
      onDragOver: (e: DragEvent) => {
        e.preventDefault();
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) void send(f);
      },
    },
    input: (
      <input
        ref={ref}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        aria-label="Choose a spreadsheet"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void send(f);
          e.target.value = "";
        }}
      />
    ),
  };
}

export function SheetDrop({
  orgSlug,
  onDropped,
  hint = "CSV or Excel, or an export from another CRM. Up to 4 MB.",
}: {
  orgSlug: string;
  onDropped: (sheet: DroppedSheet) => void;
  hint?: string;
}) {
  const upload = useSheetUpload(orgSlug, onDropped);
  return (
    <div
      {...upload.zone}
      className={cn(
        "border-input bg-muted/40 flex flex-wrap items-center gap-3.5 rounded-[1.75rem] border-[1.5px] border-dashed px-5 py-4 transition-colors sm:rounded-full",
        upload.over && "bg-muted border-foreground/40",
      )}
    >
      <Upload className="size-[22px] shrink-0" aria-hidden="true" />
      <span className="flex min-w-0 flex-[1_1_14rem] flex-col gap-0.5">
        <b className="text-[15px]">Drop a spreadsheet here</b>
        <span className="text-muted-foreground text-sm">{hint}</span>
      </span>
      {upload.input}
      <Button type="button" variant="outline" disabled={upload.busy} onClick={upload.pick}>
        <FileSpreadsheet className="size-4" aria-hidden="true" />
        {upload.busy ? "Reading…" : "Choose a file"}
      </Button>
    </div>
  );
}

/** The dropped file and where each of its columns goes. */
export function SheetMatches({
  sheet,
  onRemove,
  changeHref,
}: {
  sheet: DroppedSheet;
  onRemove: () => void;
  /** The full importer, to change a match. */
  changeHref?: string;
}) {
  const matched = sheet.headers.filter((h) => sheet.mapping[h]);
  const skipped = sheet.headers.length - matched.length;
  return (
    <div className="border-border overflow-hidden rounded-[1.5rem] border">
      <div className="bg-muted/40 flex items-center gap-3 px-4.5 py-3.5">
        <FileSpreadsheet className="size-[18px] shrink-0" aria-hidden="true" />
        <b className="min-w-0 flex-1 truncate text-[15px]">{sheet.fileName}</b>
        <span className="text-muted-foreground text-sm">
          {sheet.total.toLocaleString("en-US")} rows
        </span>
        <button type="button" className="text-sm font-semibold hover:underline" onClick={onRemove}>
          Remove
        </button>
      </div>
      <ul>
        {matched.slice(0, 8).map((h) => (
          <li
            key={h}
            className="border-border flex items-center gap-3 border-t px-4.5 py-2.5 text-sm"
          >
            <span className="text-muted-foreground min-w-0 flex-1 truncate">{h}</span>
            <ArrowRight className="text-muted-foreground/70 size-3.5 shrink-0" aria-hidden="true" />
            <b className="min-w-0 flex-1 truncate">{targetLabel(sheet.mapping[h]!)}</b>
          </li>
        ))}
      </ul>
      <p className="border-border text-muted-foreground border-t px-4.5 py-3 text-sm">
        {matched.length > 8 ? `And ${matched.length - 8} more matched. ` : ""}
        {skipped ? `${skipped} ${skipped === 1 ? "column is" : "columns are"} left out. ` : ""}
        Anyone already here by email gets only their empty details filled.
        {changeHref && (
          <>
            {" "}
            <a
              href={changeHref}
              className="text-foreground font-semibold underline-offset-2 hover:underline"
            >
              Change the matches
            </a>
          </>
        )}
      </p>
    </div>
  );
}
