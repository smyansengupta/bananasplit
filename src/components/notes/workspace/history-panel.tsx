"use client";

import { format, isToday, isYesterday } from "date-fns";
import { Eye, History, Loader2, Pencil, Save, Trash2 } from "@/components/icons";
import { useState } from "react";

import {
  deleteNoteVersion,
  getNoteVersion,
  renameNoteVersion,
  saveNamedVersion,
  type VersionListItem,
  type VersionsResult,
} from "@/app/app/[orgSlug]/notes/version-actions";
import { ItemMenu } from "@/components/item-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { formatBytes } from "@/lib/files/types";
import { cn } from "@/lib/utils";

/**
 * Version history (Moonstone 13.3): automatic snapshots taken while people
 * edit (at most one every ten minutes, kept for the plan's history window)
 * and named versions (kept until deleted). Open one to preview it, compare
 * it with the note as it is now, or restore it.
 */

export interface PreviewVersion {
  id: string;
  name: string | null;
  createdAt: string;
  author: string | null;
  contentJson: unknown;
}

function stamp(iso: string) {
  const d = new Date(iso);
  const time = format(d, "h:mm a");
  if (isToday(d)) return `Today ${time}`;
  if (isYesterday(d)) return `Yesterday ${time}`;
  return format(
    d,
    d.getFullYear() === new Date().getFullYear() ? "EEE, MMM d, h:mm a" : "MMM d, yyyy",
  );
}

export function HistoryPanel({
  orgId,
  noteId,
  versions,
  onVersions,
  canEdit,
  canDelete,
  currentJson,
  previewId,
  onPreview,
  historyDays,
}: {
  orgId: string;
  noteId: string;
  versions: VersionListItem[];
  onVersions: (versions: VersionListItem[]) => void;
  canEdit: boolean;
  canDelete: boolean;
  /** The editor's body now, for "Name this version". */
  currentJson: () => string | null;
  previewId: string | null;
  onPreview: (version: PreviewVersion | null) => void;
  /** The plan's note-history window. */
  historyDays: number;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function apply(result: VersionsResult): boolean {
    if (result.error) {
      toast({ title: result.error, tone: "error" });
      return false;
    }
    if (result.versions) onVersions(result.versions);
    return true;
  }

  async function open(v: VersionListItem) {
    setBusy(v.id);
    try {
      const result = await getNoteVersion(orgId, noteId, v.id);
      if (result.error) {
        toast({ title: result.error, tone: "error" });
        return;
      }
      onPreview({
        id: v.id,
        name: v.name,
        createdAt: v.createdAt,
        author: v.createdBy?.name ?? null,
        contentJson: result.contentJson,
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {canEdit &&
        (naming ? (
          <form
            className="bg-card edge rounded-tile space-y-2 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              setBusy("new");
              void saveNamedVersion(orgId, noteId, name, currentJson())
                .then((r) => {
                  if (apply(r)) {
                    setNaming(false);
                    setName("");
                    toast({ title: "Saved this version", tone: "success", duration: 3000 });
                  }
                })
                .finally(() => setBusy(null));
            }}
          >
            <Input
              autoFocus
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              placeholder="Final timeline"
              aria-label="Version name"
            />
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setNaming(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!name.trim() || busy === "new"}>
                {busy === "new" && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                Save version
              </Button>
            </div>
          </form>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={() => setNaming(true)}>
            <Save className="size-4" aria-hidden="true" />
            Name this version
          </Button>
        ))}

      {versions.length === 0 ? (
        <p className="text-muted-foreground px-1 text-xs">
          No versions yet. A snapshot is kept automatically while people edit, at most one every ten
          minutes.
        </p>
      ) : (
        <ul className="space-y-0.5">
          {versions.map((v) => (
            <li key={v.id}>
              {renaming?.id === v.id ? (
                <form
                  className="flex gap-2 p-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void renameNoteVersion(orgId, noteId, v.id, renaming.name).then((r) => {
                      if (apply(r)) setRenaming(null);
                    });
                  }}
                >
                  <Input
                    autoFocus
                    value={renaming.name}
                    maxLength={120}
                    onChange={(e) => setRenaming({ id: v.id, name: e.target.value })}
                    onBlur={() => setRenaming(null)}
                    aria-label="Version name"
                  />
                </form>
              ) : (
                <div
                  className={cn(
                    "group flex items-center gap-2.5 rounded-xl px-2 py-2",
                    previewId === v.id ? "bg-muted" : "hover:bg-muted/60",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => void open(v)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  >
                    {busy === v.id ? (
                      <Loader2
                        className="text-muted-foreground size-4 shrink-0 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <History
                        className="text-muted-foreground size-4 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold">
                        {v.name ?? "Autosave"}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {stamp(v.createdAt)}
                        {v.createdBy?.name ? ` · ${v.createdBy.name}` : ""}
                      </span>
                    </span>
                  </button>
                  <ItemMenu
                    label={`Actions for ${v.name ?? "this autosave"}`}
                    size="xs"
                    items={[
                      { label: "Open", icon: Eye, onSelect: () => void open(v) },
                      canEdit && {
                        label: v.name ? "Rename" : "Name it",
                        icon: Pencil,
                        onSelect: () => setRenaming({ id: v.id, name: v.name ?? "" }),
                      },
                      canDelete && {
                        label: "Delete version",
                        icon: Trash2,
                        destructive: true,
                        onSelect: () =>
                          void deleteNoteVersion(orgId, noteId, v.id).then((r) => {
                            if (apply(r) && previewId === v.id) onPreview(null);
                          }),
                      },
                    ]}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground px-1 text-[11px] leading-relaxed">
        Autosaves are kept {historyDays} days, named versions until someone deletes them.
        {versions.length > 0 &&
          ` ${formatBytes(versions.reduce((n, v) => n + v.sizeBytes, 0))} of the organization's storage.`}
      </p>
    </div>
  );
}
