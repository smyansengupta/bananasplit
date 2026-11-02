"use client";

import { FileUp, Loader2, Upload } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The import drop zone: a native HTML5 drop target with a file input
 * fallback. Posts the file to the upload route (4 MB cap, the server sniffs
 * the real type) and opens the new draft. The portal's own parser runs
 * inside that request, so a document it understands is ready to review by
 * the time the draft opens; anything it cannot read shows its progress.
 *
 * The "tile" variant is the org chart start screen's "Bring what you
 * have": the whole tile is the button, and text pasted anywhere on the
 * page outside a field is imported as a plain-text document.
 */

const MAX_BYTES = 4 * 1024 * 1024;
const ACCEPT =
  ".pdf,.docx,.md,.markdown,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain";

export function DropZone({
  orgId,
  orgSlug,
  disabled,
  variant = "default",
}: {
  orgId: string;
  orgSlug: string;
  disabled?: boolean;
  variant?: "default" | "tile";
}) {
  const router = useRouter();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tile = variant === "tile";

  async function upload(file: File) {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError("Files are limited to 4 MB. Export a smaller PDF or save the document as .docx.");
      return;
    }
    if (file.size === 0) {
      setError("That file is empty.");
      return;
    }
    setBusy(file.name);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/orgs/${encodeURIComponent(orgId)}/org-chart/imports`, {
        method: "POST",
        body: form,
      });
      const body = (await res.json().catch(() => ({}))) as { versionId?: string; error?: string };
      if (!res.ok || !body.versionId) {
        setError(body.error ?? "The upload failed. Try again.");
        return;
      }
      router.push(`/app/${orgSlug}/org-chart/drafts/${body.versionId}`);
    } catch {
      setError("The upload failed. Check your connection and try again.");
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  }

  const inactive = disabled || busy !== null;
  const uploadRef = useRef(upload);
  useEffect(() => {
    uploadRef.current = upload;
  });

  // The tile takes text or a file pasted anywhere outside a field.
  useEffect(() => {
    if (!tile || inactive) return;
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const file = e.clipboardData?.files[0];
      const text = e.clipboardData?.getData("text/plain")?.trim();
      if (!file && !text) return;
      e.preventDefault();
      void uploadRef.current(
        file ?? new File([text as string], "pasted.txt", { type: "text/plain" }),
      );
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [tile, inactive]);

  const fileInput = (
    <input
      ref={input}
      id={inputId}
      type="file"
      accept={ACCEPT}
      className="sr-only"
      tabIndex={tile ? -1 : undefined}
      disabled={inactive}
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) void upload(file);
      }}
    />
  );

  return (
    <div className={cn("space-y-2", tile && "flex flex-1 flex-col")}>
      <div
        onDragOver={(e) => {
          if (inactive) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        // Anywhere in the zone opens the file picker, not just its button.
        // (The input's own click bubbles here too: leave that one alone.)
        onClick={(e) => {
          if (inactive || e.target === input.current) return;
          input.current?.click();
        }}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (inactive) return;
          const file = e.dataTransfer.files[0];
          if (file) void upload(file);
        }}
        {...(tile
          ? {
              role: "button",
              tabIndex: inactive ? -1 : 0,
              "aria-disabled": inactive || undefined,
              onKeyDown: (e: React.KeyboardEvent) => {
                if (inactive || (e.key !== "Enter" && e.key !== " ")) return;
                e.preventDefault();
                input.current?.click();
              },
            }
          : {})}
        className={cn(
          "flex flex-col items-center justify-center text-center transition-colors",
          tile
            ? "bg-muted/50 focus-visible:outline-foreground min-h-[150px] flex-1 gap-2 rounded-2xl border-[1.5px] border-dashed p-6 outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
            : "gap-3 rounded-xl border-2 border-dashed p-8",
          over ? "border-primary bg-primary/5" : "border-border",
          inactive ? "opacity-60" : "hover:bg-muted/40 cursor-pointer",
        )}
      >
        {busy ? (
          <>
            <Loader2 className="text-muted-foreground size-8 animate-spin" aria-hidden="true" />
            <p className="text-sm font-medium" role="status">
              Uploading {busy}…
            </p>
          </>
        ) : tile ? (
          <>
            <Upload className="size-5" aria-hidden="true" />
            <span className="text-[13.5px] font-semibold">Drop a file, or paste text</span>
            <span className="text-muted-foreground text-[12.5px]">
              Word, PDF, Markdown or plain text
            </span>
            {fileInput}
          </>
        ) : (
          <>
            <FileUp className="text-muted-foreground size-8" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Drop your org chart document here</p>
              <p className="text-muted-foreground text-xs">
                Word, Markdown, text or PDF, up to 4 MB.
              </p>
            </div>
            {fileInput}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={inactive}
              onClick={(e) => {
                e.stopPropagation();
                input.current?.click();
              }}
            >
              Choose a file
            </Button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
