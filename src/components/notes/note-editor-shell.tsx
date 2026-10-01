"use client";

import type { JSONContent } from "@tiptap/react";
import { formatDistanceToNow } from "date-fns";
import { Check, CloudOff, History, Link2, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

import {
  updateNote,
  updateNoteDetails,
  deleteNote,
  restoreNote,
  type NoteDetailsInput,
} from "@/app/app/[orgSlug]/notes/actions";
import { ItemMenu } from "@/components/item-menu";
import { PresenceBar } from "@/components/notes/collab/presence-bar";
import { useNoteCollab, type NoteCollabState } from "@/components/notes/collab/use-note-collab";
import { NoteEditor } from "@/components/notes/editor/note-editor";
import { EventLinkPicker, type EventOption } from "@/components/notes/event-link-picker";
import {
  clearNoteBackup,
  parseNoteBackup,
  readNoteBackupRaw,
  writeNoteBackup,
} from "@/components/notes/note-backup";
import { useAutosave, type SaveStatus } from "@/components/notes/use-autosave";
import { VisibilityToggle } from "@/components/notes/visibility-toggle";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { NOTE_TRASH_DAYS } from "@/lib/notes/trash";
import { cn } from "@/lib/utils";
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

const noSubscribe = () => () => undefined;

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
  // Restoring a local backup remounts the editor with that content.
  const [restored, setRestored] = useState<{ json: JSONContent; n: number } | null>(null);
  const [backupHandled, setBackupHandled] = useState(false);
  // Once this visit writes its own backup, the one found on arrival is stale.
  const [wroteBackup, setWroteBackup] = useState(false);
  const [confirmEl, confirm] = useConfirm();

  const session = useNoteCollab({ orgId, noteId: note.id, initial: collab });
  // The collaborative editor, once joined (it stays, read-only, if the
  // connection is interrupted).
  const live = session.mode === "live" || session.mode === "interrupted" ? session.live : null;

  // A copy of edits the server never got (this browser only).
  const backupRaw = useSyncExternalStore(
    noSubscribe,
    () => readNoteBackupRaw(note.id),
    () => null,
  );
  const backup = parseNoteBackup(backupRaw);
  const showBackup =
    !backupHandled &&
    !wroteBackup &&
    !live &&
    canEdit &&
    backup !== null &&
    (backup.contentText !== note.contentText || backup.title !== note.title);

  // The autosave path: the whole note, version-checked. The snapshot is
  // kept locally until the server confirms it.
  const { status, schedule, retry } = useAutosave<NotePayload>({
    save: async (payload) => {
      writeNoteBackup(note.id, {
        title: payload.title,
        contentJson: payload.contentJson,
        contentText: payload.contentText,
        baseVersion: versionRef.current,
        savedAt: Date.now(),
      });
      setWroteBackup(true);
      const result = await updateNote(orgId, note.id, payload, versionRef.current);
      if (result.version) versionRef.current = result.version;
      if (!result.error && !result.conflict) clearNoteBackup(note.id);
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

  function restoreBackup() {
    if (!backup) return;
    let json: JSONContent;
    try {
      json = JSON.parse(backup.contentJson) as JSONContent;
    } catch {
      clearNoteBackup(note.id);
      setBackupHandled(true);
      return;
    }
    contentRef.current = { json, text: backup.contentText };
    setTitle(backup.title);
    setRestored((r) => ({ json, n: (r?.n ?? 0) + 1 }));
    setBackupHandled(true);
    schedule({
      title: backup.title,
      contentJson: backup.contentJson,
      contentText: backup.contentText,
      visibility,
      eventId,
    });
  }

  async function remove() {
    const name = title.trim() || "Untitled note";
    const ok = await confirm({
      title: `Delete “${name}”?`,
      description: `It moves to Recently deleted in Notes for ${NOTE_TRASH_DAYS} days, so you can bring it back.`,
      confirmLabel: "Delete note",
      run: async () => (await deleteNote(orgId, note.id)).error,
    });
    if (!ok) return;
    clearNoteBackup(note.id);
    router.push(`/app/${orgSlug}/notes`);
    toast({
      title: "Note deleted",
      description: name,
      action: {
        label: "Undo",
        run: async () => {
          const result = await restoreNote(orgId, note.id);
          if (result.error) return result.error;
          router.push(`/app/${orgSlug}/notes/${note.id}`);
        },
      },
    });
  }

  function copyLink() {
    void navigator.clipboard
      ?.writeText(`${window.location.origin}/app/${orgSlug}/notes/${note.id}`)
      .then(() => toast({ title: "Link copied", tone: "success", duration: 3_000 }))
      .catch(() => toast({ title: "Couldn't copy the link", tone: "error" }));
  }

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

  const effective = live ? detailsStatus : status;

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
      {showBackup && backup && (
        <div className="border-warning/40 bg-warning/10 flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
          <History className="text-warning size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            Changes you made {formatDistanceToNow(backup.savedAt, { addSuffix: true })} never reached the
            server. They&apos;re still in this browser.
            {backup.baseVersion < note.version &&
              " The note has changed since, so restoring them replaces the newer version."}
          </span>
          <Button type="button" size="sm" onClick={restoreBackup}>
            Restore them
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              clearNoteBackup(note.id);
              setBackupHandled(true);
            }}
          >
            Discard
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
          className="min-w-0 flex-1 border-none px-0 text-2xl font-semibold shadow-none focus-visible:ring-0"
        />
        <div className="flex shrink-0 items-center gap-2">
          {live && <PresenceBar peers={session.peers} />}
          <SaveIndicator label={saveLabel(session, effective)} status={effective} onRetry={live ? undefined : retry} />
          {canEdit && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => void remove()}
              aria-label="Delete note"
            >
              <Trash2 className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Delete</span>
            </Button>
          )}
          <ItemMenu
            label="More note actions"
            items={[
              { label: "Copy link", icon: Link2, onSelect: copyLink },
              canEdit && { label: "Delete note", icon: Trash2, destructive: true, onSelect: () => void remove() },
            ]}
          />
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
          key={`autosave-${restored?.n ?? 0}`}
          content={restored?.json ?? note.contentJson}
          editable={canType}
          onChange={(json, text) => {
            contentRef.current = { json, text };
            queueSave({});
          }}
        />
      )}
      {confirmEl}
    </div>
  );
}

/** What the corner of the editor says: the save, or the live connection. */
function saveLabel(session: NoteCollabState, status: SaveStatus): string {
  if (session.mode === "connecting") return "Connecting…";
  if (status === "saving" || status === "pending") return "Saving…";
  if (status === "conflict") return "Conflict";
  if (status === "error") return "Couldn't save — retrying";
  if (session.mode !== "live") return status === "saved" ? "Saved" : "";
  if (session.connection !== "connected") return "Offline — reconnecting…";
  if (session.unsynced > 0) return "Syncing…";
  return session.stored > 0 || status === "saved" ? "Saved" : "Live";
}

function SaveIndicator({
  label,
  status,
  onRetry,
}: {
  label: string;
  status: SaveStatus;
  onRetry?: () => void;
}) {
  if (!label) return null;
  const Icon =
    status === "error" ? CloudOff : status === "saving" || status === "pending" ? Loader2 : label === "Saved" ? Check : null;
  return (
    <span
      aria-live="polite"
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-xs",
        status === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {Icon && (
        <Icon
          className={cn("size-3.5", (status === "saving" || status === "pending") && "animate-spin")}
          aria-hidden="true"
        />
      )}
      {label}
      {status === "error" && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="hover:bg-destructive/10 ms-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium underline-offset-2 hover:underline"
        >
          <RotateCcw className="size-3" aria-hidden="true" />
          Retry now
        </button>
      )}
    </span>
  );
}
