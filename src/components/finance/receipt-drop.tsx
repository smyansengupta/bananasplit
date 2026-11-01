"use client";

import { Loader2, Sparkles, Upload, X } from "@/components/icons";
import { useRef, useState } from "react";

import { MAX_UPLOAD_BYTES, prepareReceiptForUpload } from "@/lib/finance/prepare-receipt";
import { cn } from "@/lib/utils";

/** What reading a receipt filled in (src/app/api/orgs/[orgId]/ai/receipt-read). */
export interface ReceiptRead {
  amount: string | null;
  date: string | null;
  description: string | null;
  counterparty: string | null;
  category: string | null;
}

const TOO_LARGE = "Receipts are capped at 4 MB. Try a smaller photo or a compressed PDF.";

/** Downscales a phone photo when it's over the cap; null when it still doesn't fit. */
export async function prepareReceipt(file: File): Promise<File | null> {
  let prepared: File;
  try {
    prepared = await prepareReceiptForUpload(file);
  } catch {
    prepared = file;
  }
  return prepared.size > MAX_UPLOAD_BYTES ? null : prepared;
}

/**
 * Attaches a receipt to a saved transaction (POST /api/orgs/{orgId}/receipts).
 * Returns an error message, or null.
 */
export async function uploadReceipt(
  orgId: string,
  transactionId: string,
  file: File,
): Promise<string | null> {
  const prepared = await prepareReceipt(file);
  if (!prepared) return TOO_LARGE;
  const form = new FormData();
  form.set("transactionId", transactionId);
  form.set("file", prepared);
  try {
    const response = await fetch(`/api/orgs/${orgId}/receipts`, { method: "POST", body: form });
    if (response.ok) return null;
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    return body?.error ?? "The upload failed. Try again.";
  } catch {
    return "The upload failed. Check your connection.";
  }
}

/** Reads a receipt with the club's AI model; null when nothing could be read. */
async function readReceipt(orgId: string, file: File): Promise<ReceiptRead | null> {
  const prepared = await prepareReceipt(file);
  if (!prepared) return null;
  const form = new FormData();
  form.set("file", prepared);
  try {
    const response = await fetch(`/api/orgs/${orgId}/ai/receipt-read`, {
      method: "POST",
      body: form,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { filled?: boolean } & ReceiptRead;
    return body.filled ? body : null;
  } catch {
    return null;
  }
}

/**
 * The receipt, first thing on a new expense: drop or pick a photo or PDF and
 * the form fills itself in from it (when the club has an AI model
 * connected). The file is held here and uploaded once the expense exists.
 */
export function ReceiptDrop({
  orgId,
  file,
  onFile,
  onRead,
  className,
}: {
  orgId: string;
  file: File | null;
  onFile: (file: File | null) => void;
  /** What the receipt said, to fill the empty fields with. */
  onRead?: (read: ReceiptRead) => void;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function take(next: File | undefined) {
    if (!next) return;
    setError(null);
    if (!(await prepareReceipt(next))) {
      setError(TOO_LARGE);
      return;
    }
    onFile(next);
    if (!onRead) return;
    setReading(true);
    const read = await readReceipt(orgId, next);
    setReading(false);
    if (read) onRead(read);
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          void take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {file ? (
        <div className="bg-muted/60 rounded-tile flex items-center gap-3 p-2.5 pr-1.5">
          <span
            aria-hidden="true"
            className="bg-receipt ring-foreground/10 h-10 w-8 shrink-0 rounded-[6px] ring-1"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium break-words">{file.name}</span>
            <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[12px]">
              {reading ? (
                <>
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                  Reading the receipt
                </>
              ) : (
                "Attached"
              )}
            </span>
          </span>
          <button
            type="button"
            aria-label="Remove the receipt"
            onClick={() => onFile(null)}
            className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-8 shrink-0 place-items-center rounded-full"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void take(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            "rounded-block focus-glow flex w-full items-center gap-3 border-[1.5px] border-dashed px-4 py-3.5 text-left transition-colors",
            over ? "border-foreground bg-muted/60" : "border-border hover:bg-muted/40",
          )}
        >
          <span className="bg-muted grid size-9 shrink-0 place-items-center rounded-full">
            <Upload className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">Add the receipt</span>
            <span className="text-muted-foreground inline-flex items-center gap-1 text-[12px]">
              {onRead && <Sparkles className="size-3" aria-hidden="true" />}
              {onRead
                ? "Fills in the rest. Photo or PDF, up to 4 MB."
                : "Photo or PDF, up to 4 MB."}
            </span>
          </span>
        </button>
      )}
      {error && <p className="text-tint-danger-foreground text-[13px]">{error}</p>}
    </div>
  );
}
