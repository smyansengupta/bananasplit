"use client";

import type { JSONContent } from "@tiptap/react";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { updateNote, deleteNote } from "@/app/app/[orgSlug]/notes/actions";
import { DownloadPdfButton } from "@/components/notes/download-pdf-button";
import { NoteEditor } from "@/components/notes/editor/note-editor";
import { EventLinkPicker, type EventOption } from "@/components/notes/event-link-picker";
import { useAutosave } from "@/components/notes/use-autosave";
import { VisibilityToggle } from "@/components/notes/visibility-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Visibility = "PRIVATE" | "ORGANIZATION";

interface NotePayload {
  title: string;
  /** JSON.stringify'd ProseMirror doc — see the comment on the server schema. */
  contentJson: string;
  contentText: string;
  visibility: Visibility;
  eventId: string | null;
}

export interface NoteEditorShellProps {
  orgId: string;
  orgSlug: string;
  note: {
    id: string;
    title: string;
    contentJson: JSONContent;
    contentText: string;
    visibility: Visibility;
    eventId: string | null;
    version: number;
  };
  canEdit: boolean;
  events: EventOption[];
}

export function NoteEditorShell({ orgId, orgSlug, note, canEdit, events }: NoteEditorShellProps) {
  const router = useRouter();
  const [title, setTitle] = useState(note.title);
  const [visibility, setVisibility] = useState<Visibility>(note.visibility);
  const [eventId, setEventId] = useState(note.eventId);
  const versionRef = useRef(note.version);
  const contentRef = useRef({ json: note.contentJson, text: note.contentText });

  const { status, schedule, flush } = useAutosave<NotePayload>({
    save: async (payload) => {
      const result = await updateNote(orgId, note.id, payload, versionRef.current);
      if (result.version) versionRef.current = result.version;
      return result;
    },
  });

  const canType = canEdit && status !== "conflict";

  const queueSave = useCallback(
    (overrides: Partial<NotePayload>) => {
      if (!canType) return;
      schedule({
        title,
        contentJson: JSON.stringify(contentRef.current.json),
        contentText: contentRef.current.text,
        visibility,
        eventId,
        ...overrides,
      });
    },
    [canType, schedule, title, visibility, eventId],
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {status === "conflict" && (
        <div className="border-destructive/30 bg-destructive/10 text-destructive flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
          <span>This note was updated by someone else — reload to see the latest version.</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
          >
            Reload
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          value={title}
          disabled={!canType}
          onChange={(e) => {
            setTitle(e.target.value);
            queueSave({ title: e.target.value });
          }}
          placeholder="Untitled note"
          className="border-none px-0 text-2xl font-semibold shadow-none focus-visible:ring-0"
        />
        <SaveIndicator status={status} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <VisibilityToggle
          value={visibility}
          disabled={!canType}
          onChange={(v) => {
            setVisibility(v);
            queueSave({ visibility: v });
          }}
        />
        <EventLinkPicker
          events={events}
          value={eventId}
          disabled={!canType}
          onChange={(id) => {
            setEventId(id);
            queueSave({ eventId: id });
          }}
        />
        <div className="ml-auto flex items-center gap-1">
          <DownloadPdfButton href={`/app/${orgSlug}/notes/${note.id}/pdf`} beforeDownload={flush} />
          {canEdit && (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              onClick={async () => {
                await deleteNote(orgId, note.id);
                router.push(`/app/${orgSlug}/notes`);
              }}
            >
              Delete
            </Button>
          )}
        </div>
      </div>

      <NoteEditor
        content={note.contentJson}
        editable={canType}
        onChange={(json, text) => {
          contentRef.current = { json, text };
          queueSave({});
        }}
      />
    </div>
  );
}

function SaveIndicator({ status }: { status: string }) {
  const label =
    status === "saving"
      ? "Saving…"
      : status === "saved"
        ? "Saved"
        : status === "conflict"
          ? "Conflict"
          : status === "error"
            ? "Couldn't save"
            : "";
  if (!label) return null;
  return <span className="text-muted-foreground shrink-0 text-xs">{label}</span>;
}
