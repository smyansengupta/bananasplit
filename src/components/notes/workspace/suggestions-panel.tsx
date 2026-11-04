"use client";

import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { formatDistanceToNowStrict } from "date-fns";
import { Check, X } from "@/components/icons";

import { decideSuggestion, editorSuggestions } from "@/components/notes/editor/suggesting";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { NoteSuggestion } from "@/lib/notes/suggestions";

/**
 * Pending suggestions (Suggesting mode): each insertion and deletion with
 * who made it, to accept or reject one at a time or all at once. Whoever
 * can edit the note decides. The switch that turns Suggesting on lives
 * here too, beside what it makes, rather than in a menu.
 */
export function SuggestionsPanel({
  editor,
  canDecide,
  suggesting,
  onSuggesting,
}: {
  editor: Editor;
  canDecide: boolean;
  suggesting?: boolean;
  onSuggesting?: (on: boolean) => void;
}) {
  const suggestions = useEditorState({
    editor,
    selector: ({ editor: e }) => editorSuggestions(e),
    equalityFn: (a, b) =>
      a.length === b?.length && a.every((s, i) => s.id === b[i]!.id && s.text === b[i]!.text),
  });

  function decide(id: string | null, decision: "accept" | "reject") {
    decideSuggestion(editor, id, decision);
  }

  const toggle = canDecide && onSuggesting && (
    <label className="bg-muted/60 rounded-tile flex items-center justify-between gap-3 px-3 py-2 text-sm font-medium">
      Suggest edits
      <Switch checked={Boolean(suggesting)} onCheckedChange={onSuggesting} />
    </label>
  );

  if (suggestions.length === 0) {
    return (
      <div className="space-y-3">
        {toggle}
        <p className="text-muted-foreground px-1 text-xs">No suggestions.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {toggle}
      {canDecide && (
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => decide(null, "accept")}
          >
            <Check className="size-4" aria-hidden="true" />
            Accept all
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => decide(null, "reject")}>
            Reject all
          </Button>
        </div>
      )}
      <ul className="space-y-2">
        {suggestions.map((s) => (
          <SuggestionRow
            key={`${s.kind}-${s.id}`}
            s={s}
            canDecide={canDecide}
            onDecide={decide}
            editor={editor}
          />
        ))}
      </ul>
    </div>
  );
}

function SuggestionRow({
  s,
  canDecide,
  onDecide,
  editor,
}: {
  s: NoteSuggestion;
  canDecide: boolean;
  onDecide: (id: string, decision: "accept" | "reject") => void;
  editor: Editor;
}) {
  return (
    <li className="bg-card edge rounded-tile space-y-2 p-3">
      <button
        type="button"
        className="block w-full text-left"
        onClick={() =>
          editor
            .chain()
            .focus()
            .setTextSelection(s.from + 1)
            .scrollIntoView()
            .run()
        }
      >
        <span className="text-muted-foreground block text-xs">
          {s.authorName ?? "Someone"}{" "}
          {s.kind === "insert" ? "suggests adding" : "suggests removing"}
          {s.at ? `, ${formatDistanceToNowStrict(new Date(s.at), { addSuffix: true })}` : ""}
        </span>
        <span
          className={
            s.kind === "insert"
              ? "note-suggest-insert line-clamp-3 text-[13px]"
              : "note-suggest-delete line-clamp-3 text-[13px]"
          }
        >
          {s.text.trim() || "(a space)"}
        </span>
      </button>
      {canDecide && (
        <div className="flex gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => onDecide(s.id, "accept")}
          >
            <Check className="size-4" aria-hidden="true" />
            Accept
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => onDecide(s.id, "reject")}>
            <X className="size-4" aria-hidden="true" />
            Reject
          </Button>
        </div>
      )}
    </li>
  );
}
