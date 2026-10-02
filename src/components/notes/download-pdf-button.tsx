"use client";

import { Download, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

/** The UTF-8 name from a `filename*=UTF-8''...` Content-Disposition parameter. */
export function filenameFromDisposition(header: string | null): string | null {
  const match = header?.match(/filename\*=UTF-8''([^;]+)/i);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
}

/**
 * Downloads a note as a PDF from its route handler. It fetches instead of
 * navigating, so a failure shows next to the button instead of replacing the
 * page, and awaits `beforeDownload` first (the autosave flush) so the PDF
 * has the edits made in the last moment.
 */
export function DownloadPdfButton({
  href,
  beforeDownload,
}: {
  href: string;
  beforeDownload?: () => Promise<void>;
}) {
  const [state, setState] = useState<"idle" | "loading" | "error" | "rate-limited">("idle");

  async function download() {
    setState("loading");
    try {
      await beforeDownload?.();
      const res = await fetch(href, { cache: "no-store" });
      if (!res.ok) {
        setState(res.status === 429 ? "rate-limited" : "error");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filenameFromDisposition(res.headers.get("Content-Disposition")) ?? "note.pdf";
      document.body.append(link);
      link.click();
      link.remove();
      // Some browsers read the blob after click() returns; free it a moment later.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <>
      {(state === "error" || state === "rate-limited") && (
        <span role="alert" className="text-destructive text-xs">
          {state === "rate-limited"
            ? "Too many downloads — try again in a few minutes."
            : "Couldn't create the PDF."}
        </span>
      )}
      <Button type="button" variant="ghost" disabled={state === "loading"} onClick={download}>
        {state === "loading" ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Download aria-hidden="true" />
        )}
        Download PDF
      </Button>
    </>
  );
}
