"use client";

import type { JSONContent } from "@tiptap/react";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  updateNote,
  updateNoteDetails,
  deleteNote,
  type NoteDetailsInput,
} from "@/app/app/[orgSlug]/notes/actions";
import { PresenceBar } from "@/components/notes/collab/presence-bar";
import { useNoteCollab, type NoteCollabState } from "@/components/notes/collab/use-note-collab";
import { NoteEditor } from "@/components/notes/editor/note-editor";
import { EventLinkPicker, type EventOption } from "@/components/notes/event-link-picker";
import { useAutosave, type SaveStatus } from "@/components/notes/use-autosave";
import { VisibilityToggle } from "@/components/notes/visibility-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { NoteCollabSession } from "@/server/collab/session";

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
  /**
   * The page's live-collaboration session, or null while collaboration is
   * off (docs/features/collaboration.md). Without one, or when joining
   * fails, this is the autosave editor exactly as before.
   */
  collab?: NoteCollabSession | null;
}

export function NoteEditorShell({
  orgId,
  orgSlug,
  note,
  canEdit,
  events,
  collab = null,
}: NoteEditorShellProps) {
  const router = useRouter();
  const [title, setTitle] = useState(note.title);
  const [visibility, setVisibility] = useState<Visibility>(note.visibility);
  const [eventId, setEventId] = useState(note.eventId);
  const versionRef = useRef(note.version);
  const contentRef = useRef({ json: note.contentJson, text: note.contentText });

  const session = useNoteCollab({ orgId, noteId: note.id, initial: collab });
  // The collaborative editor, once joined (it stays, read-only, if the
  // connection is interrupted).
  const live = session.mode === "live" || session.mode === "interrupted" ? session.live : null;

  // The autosave path: the whole note, version-checked.
  const { status, schedule } = useAutosave<NotePayload>({
    save: async (payload) => {
      const result = await updateNote(orgId, note.id, payload, versionRef.current);
      if (result.version) versionRef.current = result.version;
      return result;
    },
  });

  // The live path: the collaboration server saves the body, so only the
  // fields that changed are sent, and each save starts a fresh batch.
  const detailsRef = useRef<NoteDetailsInput>({});
  const { status: detailsStatus, schedule: scheduleDetails } = useAutosave<NoteDetailsInput>({
    save: (patch) => {
      detailsRef.current = {};
      return updateNoteDetails(orgId, note.id, patch);
    },
  });

  const canType = live
    ? session.mode === "live" && session.canWrite
    : canEdit && status !== "conflict" && session.mode !== "connecting";

  const queueSave = useCallback(
    (overrides: Partial<NotePayload>) => {
      if (!canType) return;
      if (live) {
        const { title: t, visibility: v, eventId: e } = overrides;
        detailsRef.current = {
          ...detailsRef.current,
          ...(t !== undefined ? { title: t } : {}),
          ...(v !== undefined ? { visibility: v } : {}),
          ...(e !== undefined ? { eventId: e } : {}),
        };
        scheduleDetails(detailsRef.current);
        return;
      }
      schedule({
        title,
        contentJson: JSON.stringify(contentRef.current.json),
        contentText: contentRef.current.text,
        visibility,
        eventId,
        ...overrides,
      });
    },
    [canType, live, scheduleDetails, schedule, title, visibility, eventId],
  );

  if (session.mode === "revoked") {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="border-destructive/30 bg-destructive/10 text-destructive flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
          <span>This note is no longer available to you.</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => router.push(`/app/${orgSlug}/notes`)}
          >
            Back to notes
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
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
      {session.mode === "interrupted" && (
        <div className="border-destructive/30 bg-destructive/10 text-destructive flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
          <span>Live editing was interrupted — reload to keep editing.</span>
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
        <div className="flex shrink-0 items-center gap-3">
          {live && <PresenceBar peers={session.peers} />}
          <SaveIndicator label={saveLabel(session, live ? detailsStatus : status)} />
        </div>
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
        {canEdit && (
          <Button
            type="button"
            variant="ghost"
            className="text-destructive ml-auto"
            onClick={async () => {
              await deleteNote(orgId, note.id);
              router.push(`/app/${orgSlug}/notes`);
            }}
          >
            Delete
          </Button>
        )}
      </div>

      {live ? (
        <NoteEditor
          // A new session (another Y.Doc) needs a new editor bound to it.
          key={live.doc.guid}
          collaboration={{ doc: live.doc, provider: live.provider, user: live.user }}
          editable={canType}
        />
      ) : (
        <NoteEditor
          key="autosave"
          content={note.contentJson}
          editable={canType}
          onChange={(json, text) => {
            contentRef.current = { json, text };
            queueSave({});
          }}
        />
      )}
    </div>
  );
}

/** What the corner of the editor says: the save, or the live connection. */
function saveLabel(session: NoteCollabState, status: SaveStatus): string {
  if (session.mode === "connecting") return "Connecting…";
  if (status === "saving") return "Saving…";
  if (status === "conflict") return "Conflict";
  if (status === "error") return "Couldn't save";
  if (session.mode !== "live") return status === "saved" ? "Saved" : "";
  if (session.connection !== "connected") return "Offline — reconnecting…";
  if (session.unsynced > 0) return "Syncing…";
  return session.stored > 0 || status === "saved" ? "Saved" : "Live";
}

function SaveIndicator({ label }: { label: string }) {
  if (!label) return null;
  return <span className="text-muted-foreground shrink-0 text-xs">{label}</span>;
}
