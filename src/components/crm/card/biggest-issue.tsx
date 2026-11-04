"use client";

import { X } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { refreshIssueAction, saveIssueAction } from "@/app/app/[orgSlug]/crm/note-actions";
import { AMBIENT_BUTTON, AmbientWhy } from "@/components/ambient/ambient-button";
import { Input } from "@/components/ui/input";
import { toast, undoable } from "@/components/ui/toaster";
import type { StoredIssue } from "@/lib/crm/issue";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

/**
 * A person's biggest issue on their card's Overview (docs/features/crm.md,
 * "Notes and tasks"): one line the organization's AI keeps from their
 * notes, replies and calls, with where it came from. Click it to change
 * it; the X clears it (Undo puts it back). With none yet but something to
 * read, "Find it" asks the AI now.
 */

export interface IssueView extends StoredIssue {
  /** "From 2 notes and a reply" */
  from: string;
}

function shortDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function BiggestIssue({
  orgId,
  personId,
  issue,
  sourceCount,
  readOnly = false,
}: {
  orgId: string;
  personId: string;
  issue: IssueView | null;
  /** Notes, replies and calls it could be read from. */
  sourceCount: number;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cleared, setCleared] = useState(false);
  const shown = cleared ? null : issue;

  async function save() {
    if (editing === null || busy) return;
    const text = editing.trim();
    if (text === (shown?.text ?? "")) return setEditing(null);
    setBusy(true);
    const r = await runAction(() => saveIssueAction(orgId, personId, text ? { text } : null));
    setBusy(false);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    setEditing(null);
    setCleared(false);
    router.refresh();
  }

  async function clear() {
    if (!shown) return;
    const before: StoredIssue = {
      text: shown.text,
      at: shown.at,
      model: shown.model,
      sources: shown.sources,
    };
    setCleared(true);
    const ok = await undoable({
      title: "Cleared",
      run: async () => {
        const r = await runAction(() => saveIssueAction(orgId, personId, null));
        if (!r) return "That didn't go through. Try again.";
        if (!r.ok) return r.error;
        router.refresh();
      },
      undo: async () => {
        const r = await runAction(() => saveIssueAction(orgId, personId, { restore: before }));
        if (!r) return "That didn't go through. Try again.";
        if (!r.ok) return r.error;
        setCleared(false);
        router.refresh();
      },
    });
    if (!ok) setCleared(false);
  }

  async function find() {
    setBusy(true);
    const r = await runAction(() => refreshIssueAction(orgId, personId));
    setBusy(false);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    if (!r.issue) toast({ title: "Nothing stands out yet." });
    setCleared(false);
    router.refresh();
  }

  if (editing !== null) {
    return (
      <div className="bg-muted flex items-center gap-2 rounded-2xl px-4 py-2.5">
        <b className="shrink-0 text-[15px]">Biggest issue:</b>
        <Input
          value={editing}
          onChange={(e) => setEditing(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            }
            if (e.key === "Escape") {
              e.stopPropagation();
              setEditing(null);
            }
          }}
          disabled={busy}
          maxLength={200}
          placeholder="What they're most unhappy with, or most need"
          aria-label="Biggest issue"
          className="h-8 min-w-0 flex-1 bg-transparent"
          autoFocus
        />
      </div>
    );
  }

  if (!shown) {
    if (readOnly || sourceCount === 0) return null;
    return (
      <div className="bg-muted flex flex-nowrap items-center gap-2 rounded-2xl px-4 py-3">
        <span className="min-w-0 flex-1 text-[15px]">
          <b>Biggest issue:</b>{" "}
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setEditing("")}
          >
            none yet
          </button>
        </span>
        <AmbientWhy className="whitespace-nowrap">
          {sourceCount === 1
            ? "1 note or reply to read"
            : `${sourceCount} notes and replies to read`}
        </AmbientWhy>
        <button
          type="button"
          className={cn(
            AMBIENT_BUTTON,
            "text-foreground bg-[color-mix(in_oklab,var(--attention)_22%,var(--card))] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--attention)_40%,transparent)]",
          )}
          disabled={busy}
          onClick={() => void find()}
        >
          {busy ? "Reading…" : "Find it"}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-muted flex flex-nowrap items-start gap-2 rounded-2xl px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[15px]">
          <b>Biggest issue:</b>{" "}
          {readOnly ? (
            shown.text
          ) : (
            <button
              type="button"
              className="text-start underline-offset-4 hover:underline"
              title="Change it"
              onClick={() => setEditing(shown.text)}
            >
              {shown.text}
            </button>
          )}
        </p>
        <span className="text-muted-foreground text-xs">
          {shown.from}, {shortDay(shown.at)}
        </span>
      </div>
      {!readOnly && (
        <button
          type="button"
          onClick={() => void clear()}
          aria-label="Clear the biggest issue"
          title="Clear"
          className="text-muted-foreground hover:text-foreground hover:bg-background grid size-7 shrink-0 place-items-center rounded-full"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
