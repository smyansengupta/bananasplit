"use client";

import { useState } from "react";

import { SavedMark, useSaveOnChange } from "@/components/ui/autosave";
import { Textarea } from "@/components/ui/textarea";

import { savePulseNoteAction } from "./actions";

/**
 * The admin's note on this week's draft pulse: a line or two at the top of
 * what goes out. Saves itself when you click away; clearing it removes it.
 */
export function PulseNoteForm({
  orgId,
  issueId,
  initial,
  sendsAt,
}: {
  orgId: string;
  issueId: string;
  initial: string | null;
  /** "Fri, Oct 23 at 5:00 PM". */
  sendsAt: string;
}) {
  const [note, setNote] = useState(initial ?? "");
  const { status, error, save } = useSaveOnChange(
    async (value: string) => {
      const result = await savePulseNoteAction(orgId, { issueId, note: value });
      if (!result.ok) return result.error ?? "That note couldn't be saved.";
    },
    { initial: (initial ?? "").trim() },
  );

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor="pulse-note" className="heading block text-[15px]">
          Note
        </label>
        <SavedMark status={status} error={error} />
      </div>
      <p className="text-muted-foreground text-sm">Goes out {sendsAt}.</p>
      <Textarea
        id="pulse-note"
        value={note}
        maxLength={1000}
        rows={3}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => save(note.trim())}
        placeholder="Venue tour done: the ballroom it is. Photographer quotes are due Friday."
      />
      <span className="text-muted-foreground block text-[13px] tabular-nums">
        {note.length}/1000
      </span>
    </div>
  );
}
