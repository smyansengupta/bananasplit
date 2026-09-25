"use client";

import { FileUp, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The import drop zone: a native HTML5 drop target with a file input
 * fallback. Posts the file to the upload route (4 MB cap, the server sniffs
 * the real type) and opens the new draft. The portal's own parser runs
 * inside that request, so a document it understands is ready to review by
 * the time the draft opens; anything it cannot read shows its progress.
 */

const MAX_BYTES = 4 * 1024 * 1024;
const ACCEPT = ".pdf,.docx,.md,.markdown,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain";

export function DropZone({ orgId, orgSlug, disabled }: { orgId: string; orgSlug: string; disabled?: boolean }) {
  const router = useRouter();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      const res = await fetch(`/api/orgs/${encodeURIComponent(orgId)}/org-chart/imports`, { method: "POST", body: form });
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

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => {
          if (inactive) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (inactive) return;
          const file = e.dataTransfer.files[0];
          if (file) void upload(file);
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
          over ? "border-primary bg-primary/5" : "border-border",
          inactive && "opacity-60",
        )}
      >
        {busy ? (
          <>
            <Loader2 className="text-muted-foreground size-8 animate-spin" aria-hidden="true" />
            <p className="text-sm font-medium" role="status">
              Uploading {busy}…
            </p>
          </>
        ) : (
          <>
            <FileUp className="text-muted-foreground size-8" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Drop your org chart document here</p>
              <p className="text-muted-foreground text-xs">
                Word (.docx), Google Doc export, Markdown, text or PDF, up to 4 MB. No API key needed.
              </p>
            </div>
            <input
              ref={input}
              id={inputId}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              disabled={inactive}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <Button type="button" variant="outline" size="sm" disabled={inactive} onClick={() => input.current?.click()}>
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
