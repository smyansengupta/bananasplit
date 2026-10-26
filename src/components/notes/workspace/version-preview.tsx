"use client";

import { generateText, type JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { format } from "date-fns";
import { ArrowLeft, Loader2, RotateCcw } from "@/components/icons";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { noteSchemaExtensions } from "@/lib/notes/schema-extensions";
import { diffStats, diffText } from "@/lib/notes/text-diff";

import type { PreviewVersion } from "./history-panel";

/**
 * A version, opened from the history: as it was (read-only), or compared
 * with the note now (words added and removed since). Restore puts it back
 * as an edit, after keeping the current body as a snapshot.
 */
export function VersionPreview({
  version,
  currentText,
  canRestore,
  onRestore,
  onClose,
}: {
  version: PreviewVersion;
  currentText: string;
  canRestore: boolean;
  onRestore: () => Promise<void>;
  onClose: () => void;
}) {
  const [view, setView] = useState<"version" | "compare">("version");
  const [busy, setBusy] = useState(false);
  const extensions = useMemo(() => noteSchemaExtensions(), []);
  const editor = useEditor(
    {
      editable: false,
      immediatelyRender: false,
      extensions,
      content: version.contentJson as JSONContent,
      editorProps: {
        attributes: {
          class: "tiptap prose prose-sm sm:prose-base dark:prose-invert max-w-none",
        },
      },
    },
    [version.id],
  );
  const parts = useMemo(() => {
    let before = "";
    try {
      before = generateText(version.contentJson as JSONContent, extensions);
    } catch {
      before = "";
    }
    return diffText(before, currentText);
  }, [version.contentJson, currentText, extensions]);
  const stats = diffStats(parts);

  return (
    <div className="space-y-4">
      <div className="bg-tint-accent rounded-tile flex flex-wrap items-center gap-3 px-4 py-3">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={onClose}
          aria-label="Back to the note"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{version.name ?? "Autosave"}</p>
          <p className="text-muted-foreground truncate text-xs">
            {format(new Date(version.createdAt), "EEE, MMM d, h:mm a")}
            {version.author ? ` · ${version.author}` : ""}
          </p>
        </div>
        <Segmented
          label="Show"
          options={[
            { value: "version", label: "This version" },
            { value: "compare", label: "Compare with now" },
          ]}
          value={view}
          onSelect={(v) => setView(v as "version" | "compare")}
        />
        {canRestore && (
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onRestore().finally(() => setBusy(false));
            }}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <RotateCcw className="size-4" aria-hidden="true" />
            )}
            Restore this version
          </Button>
        )}
      </div>
      {view === "version" ? (
        <div className="note-editor is-page">
          {editor ? <EditorContent editor={editor} /> : <div className="h-40" />}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs">
            Since this version: {stats.added} word{stats.added === 1 ? "" : "s"} added,{" "}
            {stats.removed} removed.
          </p>
          <div className="bg-card edge rounded-tile p-5 text-[15px] leading-relaxed whitespace-pre-wrap">
            {parts.map((p, i) =>
              p.kind === "same" ? (
                <span key={i}>{p.text}</span>
              ) : p.kind === "added" ? (
                <ins key={i} className="note-suggest-insert no-underline">
                  {p.text}
                </ins>
              ) : (
                <del key={i} className="note-suggest-delete">
                  {p.text}
                </del>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
