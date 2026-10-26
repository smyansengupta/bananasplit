"use client";

import type { Editor } from "@tiptap/core";
import { formatDistanceToNowStrict } from "date-fns";
import { Check, Loader2, MessageSquarePlus, Pencil, RotateCcw, Trash2 } from "@/components/icons";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  addNoteComment,
  deleteNoteComment,
  editNoteComment,
  resolveNoteThread,
  type CommentsResult,
} from "@/app/app/[orgSlug]/notes/comment-actions";
import { ItemMenu } from "@/components/item-menu";
import { threadRanges } from "@/components/notes/editor/comment-highlights";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toaster";
import { UserAvatar } from "@/components/user-avatar";
import type { TextAnchor } from "@/lib/notes/comment-anchor";
import { cn } from "@/lib/utils";
import type { NoteCommentDto } from "@/server/notes/comments";

import { MentionTextarea, mentionedIds, type MentionablePerson } from "./mention-textarea";

/**
 * Comments on a note (Moonstone 13.3), in both modes: select text and
 * Comment (or comment on the whole note), reply, @mention people (they're
 * told), resolve and reopen. In Document mode the threads sit in the
 * margin beside their passage, as in Google Docs; in Page mode and on
 * phones they're a list.
 */

export interface CommentDraft {
  anchorText: string | null;
  anchor: TextAnchor | null;
}

interface Thread {
  root: NoteCommentDto;
  replies: NoteCommentDto[];
}

export function groupThreads(comments: NoteCommentDto[]): Thread[] {
  const byRoot = new Map<string, Thread>();
  for (const c of comments) if (!c.threadId) byRoot.set(c.id, { root: c, replies: [] });
  for (const c of comments) if (c.threadId) byRoot.get(c.threadId)?.replies.push(c);
  return [...byRoot.values()];
}

function when(iso: string) {
  return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
}

export function CommentsPanel({
  orgId,
  noteId,
  editor,
  viewerId,
  canResolve,
  canModerate,
  people,
  comments,
  onComments,
  draft,
  onDraftDone,
  activeId,
  onActive,
  aligned,
}: {
  orgId: string;
  noteId: string;
  editor: Editor | null;
  viewerId: string;
  /** Can edit the note: resolves threads. */
  canResolve: boolean;
  /** Can share the note: deletes anyone's comment. */
  canModerate: boolean;
  people: MentionablePerson[];
  comments: NoteCommentDto[];
  onComments: (comments: NoteCommentDto[]) => void;
  draft: CommentDraft | null;
  onDraftDone: () => void;
  activeId: string | null;
  onActive: (id: string | null) => void;
  /** Document mode: the threads beside their passages. */
  aligned: boolean;
}) {
  const [showResolved, setShowResolved] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  const threads = groupThreads(comments);
  const open = threads.filter((t) => !t.root.resolvedAt);
  const resolved = threads.filter((t) => t.root.resolvedAt);

  function apply(result: CommentsResult): boolean {
    if (result.error) {
      toast({ title: result.error, tone: "error" });
      return false;
    }
    if (result.comments) onComments(result.comments);
    return true;
  }

  // Positions of the threads beside their passages, in Document mode.
  const container = useRef<HTMLDivElement>(null);
  const [tops, setTops] = useState<Map<string, number>>(new Map());
  // Which threads the editor found, and where (follows every transaction).
  const [rangeKey, setRangeKey] = useState("");
  useEffect(() => {
    if (!editor) return;
    const read = () => {
      if (editor.isDestroyed) return;
      const key = [...threadRanges(editor.state).entries()]
        .map(([id, r]) => `${id}:${r.from}`)
        .join(",");
      setRangeKey((prev) => (prev === key ? prev : key));
    };
    read();
    editor.on("transaction", read);
    return () => {
      editor.off("transaction", read);
    };
  }, [editor]);
  const found = new Set(rangeKey ? rangeKey.split(",").map((part) => part.split(":")[0]) : []);
  useLayoutEffect(() => {
    if (!aligned || !editor || !container.current) return;
    const measure = () => {
      const box = container.current?.getBoundingClientRect();
      if (!box || editor.isDestroyed) return;
      const wanted: { id: string; top: number }[] = [];
      for (const [id, range] of threadRanges(editor.state)) {
        try {
          wanted.push({ id, top: editor.view.coordsAtPos(range.from).top - box.top });
        } catch {
          // A position the view can't place yet.
        }
      }
      wanted.sort((a, b) => a.top - b.top);
      const next = new Map<string, number>();
      let floor = 0;
      for (const w of wanted) {
        const el = container.current?.querySelector<HTMLElement>(`[data-thread="${w.id}"]`);
        const top = Math.max(w.top, floor);
        next.set(w.id, top);
        floor = top + (el?.offsetHeight ?? 120) + 10;
      }
      setTops((prev) =>
        prev.size === next.size &&
        [...next].every(([k, v]) => Math.abs((prev.get(k) ?? -1) - v) < 1)
          ? prev
          : next,
      );
    };
    measure();
    editor.on("transaction", measure);
    window.addEventListener("resize", measure);
    return () => {
      editor.off("transaction", measure);
      window.removeEventListener("resize", measure);
    };
  }, [aligned, editor, rangeKey, comments, draft, activeId]);

  const anchored = aligned ? open.filter((t) => tops.has(t.root.id)) : [];
  const listed = aligned ? open.filter((t) => !tops.has(t.root.id)) : open;
  const height = Math.max(0, ...[...tops.values()].map((t) => t + 220));

  return (
    <div className="space-y-3">
      {draft ? (
        <NewThread
          orgId={orgId}
          noteId={noteId}
          draft={draft}
          people={people}
          onDone={(result) => {
            if (result && apply(result)) {
              if (result.commentId) onActive(result.commentId);
            }
            onDraftDone();
          }}
        />
      ) : (
        <p className="text-muted-foreground px-1 text-xs">
          Select text in the note and choose Comment, or comment on the whole note below.
        </p>
      )}

      {listed.map((t) => (
        <ThreadCard
          key={t.root.id}
          thread={t}
          orgId={orgId}
          noteId={noteId}
          viewerId={viewerId}
          canResolve={canResolve}
          canModerate={canModerate}
          people={people}
          active={activeId === t.root.id}
          detached={Boolean(t.root.anchorText) && !found.has(t.root.id)}
          onActive={onActive}
          apply={apply}
          confirm={confirm}
          editor={editor}
        />
      ))}

      {anchored.length > 0 && (
        <div ref={container} className="relative" style={{ height }}>
          {anchored.map((t) => (
            <div
              key={t.root.id}
              data-thread={t.root.id}
              className="absolute inset-x-0 transition-[top] duration-300 ease-(--ease-ink)"
              style={{ top: tops.get(t.root.id) }}
            >
              <ThreadCard
                thread={t}
                orgId={orgId}
                noteId={noteId}
                viewerId={viewerId}
                canResolve={canResolve}
                canModerate={canModerate}
                people={people}
                active={activeId === t.root.id}
                detached={false}
                onActive={onActive}
                apply={apply}
                confirm={confirm}
                editor={editor}
              />
            </div>
          ))}
        </div>
      )}
      {/* The measuring box for alignment, when nothing is aligned yet. */}
      {aligned && anchored.length === 0 && <div ref={container} />}

      {!draft && <NoteLevelComment orgId={orgId} noteId={noteId} people={people} apply={apply} />}

      {resolved.length > 0 && (
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setShowResolved((s) => !s)}
            className="text-muted-foreground hover:text-foreground px-1 text-xs font-medium"
          >
            {showResolved ? "Hide" : "Show"} resolved ({resolved.length})
          </button>
          {showResolved && (
            <div className="mt-2 space-y-3 opacity-80">
              {resolved.map((t) => (
                <ThreadCard
                  key={t.root.id}
                  thread={t}
                  orgId={orgId}
                  noteId={noteId}
                  viewerId={viewerId}
                  canResolve={canResolve}
                  canModerate={canModerate}
                  people={people}
                  active={activeId === t.root.id}
                  detached={false}
                  onActive={onActive}
                  apply={apply}
                  confirm={confirm}
                  editor={editor}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {confirmEl}
    </div>
  );
}

function NewThread({
  orgId,
  noteId,
  draft,
  people,
  onDone,
}: {
  orgId: string;
  noteId: string;
  draft: CommentDraft;
  people: MentionablePerson[];
  onDone: (result: CommentsResult | null) => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const mentions = useRef(new Map<string, string>());

  async function submit() {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      const result = await addNoteComment(orgId, noteId, {
        body,
        anchorText: draft.anchorText,
        anchor: draft.anchor,
        mentions: mentionedIds(body, mentions.current),
      });
      onDone(result);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-card edge rounded-tile space-y-2.5 p-3">
      {draft.anchorText && <Quote text={draft.anchorText} />}
      <MentionTextarea
        autoFocus
        value={body}
        onChange={setBody}
        people={people}
        mentionsRef={mentions}
        onSubmit={() => void submit()}
        placeholder="Add a comment. @ to mention someone"
        label="New comment"
      />
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onDone(null)}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void submit()}
          disabled={busy || !body.trim()}
        >
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          Comment
        </Button>
      </div>
    </div>
  );
}

function NoteLevelComment({
  orgId,
  noteId,
  people,
  apply,
}: {
  orgId: string;
  noteId: string;
  people: MentionablePerson[];
  apply: (result: CommentsResult) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const mentions = useRef(new Map<string, string>());
  if (!open) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <MessageSquarePlus className="size-4" aria-hidden="true" />
        Comment on the whole note
      </Button>
    );
  }
  async function submit() {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      const result = await addNoteComment(orgId, noteId, {
        body,
        mentions: mentionedIds(body, mentions.current),
      });
      if (apply(result)) {
        setBody("");
        setOpen(false);
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="bg-card edge rounded-tile space-y-2.5 p-3">
      <MentionTextarea
        autoFocus
        value={body}
        onChange={setBody}
        people={people}
        mentionsRef={mentions}
        onSubmit={() => void submit()}
        placeholder="A comment on the whole note"
        label="Comment on the whole note"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void submit()}
          disabled={busy || !body.trim()}
        >
          Comment
        </Button>
      </div>
    </div>
  );
}

function Quote({ text }: { text: string }) {
  return (
    <p className="text-muted-foreground border-glow line-clamp-2 border-l-2 pl-2.5 text-xs italic">
      {text}
    </p>
  );
}

function ThreadCard({
  thread,
  orgId,
  noteId,
  viewerId,
  canResolve,
  canModerate,
  people,
  active,
  detached,
  onActive,
  apply,
  confirm,
  editor,
}: {
  thread: Thread;
  orgId: string;
  noteId: string;
  viewerId: string;
  canResolve: boolean;
  canModerate: boolean;
  people: MentionablePerson[];
  active: boolean;
  detached: boolean;
  onActive: (id: string | null) => void;
  apply: (result: CommentsResult) => boolean;
  confirm: ReturnType<typeof useConfirm>[1];
  editor: Editor | null;
}) {
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const mentions = useRef(new Map<string, string>());
  const { root, replies } = thread;
  const isResolved = Boolean(root.resolvedAt);

  async function sendReply() {
    if (!reply.trim() || busy) return;
    setBusy(true);
    try {
      const result = await addNoteComment(orgId, noteId, {
        body: reply,
        threadId: root.id,
        mentions: mentionedIds(reply, mentions.current),
      });
      if (apply(result)) setReply("");
    } finally {
      setBusy(false);
    }
  }

  function focusPassage() {
    onActive(root.id);
    if (!editor || editor.isDestroyed) return;
    const range = threadRanges(editor.state).get(root.id);
    if (!range) return;
    try {
      const dom = editor.view.domAtPos(range.from).node;
      (dom instanceof HTMLElement ? dom : dom.parentElement)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    } catch {
      // Not on screen yet.
    }
  }

  const comment = (c: NoteCommentDto, first: boolean) => {
    const mine = c.author?.id === viewerId;
    const canDelete = mine || canModerate;
    return (
      <div key={c.id} className="space-y-1">
        <div className="flex items-center gap-2">
          <UserAvatar user={c.author ?? { name: "Former member" }} size="xs" />
          <span className="min-w-0 truncate text-[13px] font-semibold">
            {c.author?.name ?? "Former member"}
          </span>
          <span className="text-muted-foreground shrink-0 text-xs">{when(c.createdAt)}</span>
          <span className="ms-auto flex shrink-0 items-center gap-0.5">
            {first && canResolve && (
              <button
                type="button"
                aria-label={isResolved ? "Reopen the thread" : "Resolve the thread"}
                title={isResolved ? "Reopen" : "Resolve"}
                onClick={(e) => {
                  e.stopPropagation();
                  void resolveNoteThread(orgId, noteId, root.id, !isResolved).then((r) => {
                    if (apply(r) && !isResolved) {
                      onActive(null);
                      toast({ title: "Resolved the thread", tone: "success", duration: 3000 });
                    }
                  });
                }}
                className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-7 place-items-center rounded-full"
              >
                {isResolved ? (
                  <RotateCcw className="size-4" aria-hidden="true" />
                ) : (
                  <Check className="size-4" aria-hidden="true" />
                )}
              </button>
            )}
            {(mine || canDelete) && (
              <ItemMenu
                label="Comment actions"
                size="xs"
                items={[
                  mine && {
                    label: "Edit",
                    icon: Pencil,
                    onSelect: () => setEditing({ id: c.id, body: c.body }),
                  },
                  canDelete && {
                    label: first ? "Delete thread" : "Delete comment",
                    icon: Trash2,
                    destructive: true,
                    onSelect: () =>
                      void confirm({
                        title: first ? "Delete this thread?" : "Delete this comment?",
                        description: first
                          ? "Its replies go too. This can't be undone."
                          : "This can't be undone.",
                        confirmLabel: first ? "Delete thread" : "Delete comment",
                        run: async () => {
                          const r = await deleteNoteComment(orgId, noteId, c.id);
                          if (r.error) return r.error;
                          if (r.comments) apply(r);
                        },
                      }),
                  },
                ]}
              />
            )}
          </span>
        </div>
        {editing?.id === c.id ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void editNoteComment(orgId, noteId, c.id, editing.body).then((r) => {
                if (apply(r)) setEditing(null);
              });
            }}
          >
            <MentionTextarea
              autoFocus
              value={editing.body}
              onChange={(body) => setEditing({ id: c.id, body })}
              people={people}
              mentionsRef={mentions}
              onSubmit={() => undefined}
              placeholder="Comment"
              label="Edit comment"
            />
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!editing.body.trim()}>
                Save
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-[13px] leading-relaxed break-words whitespace-pre-wrap">
            {highlightMentions(c.body)}
          </p>
        )}
      </div>
    );
  };

  return (
    <article
      onClick={focusPassage}
      aria-label={`Comment by ${root.author?.name ?? "a former member"}`}
      className={cn(
        "bg-card rounded-tile cursor-default space-y-3 border p-3 transition-shadow duration-200",
        active ? "shadow-e2 border-transparent" : "edge border-transparent",
      )}
    >
      {root.anchorText && (
        <div className="space-y-1">
          <Quote text={root.anchorText} />
          {detached && (
            <p className="text-muted-foreground text-[11px]">The text it was on has changed.</p>
          )}
        </div>
      )}
      {comment(root, true)}
      {replies.map((r) => comment(r, false))}
      {isResolved ? (
        <p className="text-muted-foreground text-xs">
          Resolved{root.resolvedBy?.name ? ` by ${root.resolvedBy.name}` : ""}
          {root.resolvedAt ? `, ${when(root.resolvedAt)}` : ""}
        </p>
      ) : (
        (active || replies.length > 0 || reply) && (
          <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
            <MentionTextarea
              value={reply}
              onChange={setReply}
              people={people}
              mentionsRef={mentions}
              onSubmit={() => void sendReply()}
              placeholder="Reply. @ to mention"
              label="Reply"
            />
            {reply.trim() && (
              <div className="flex justify-end gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => setReply("")}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void sendReply()}
                  disabled={busy}
                >
                  Reply
                </Button>
              </div>
            )}
          </div>
        )
      )}
    </article>
  );
}

/** "@Name" in a comment, set in bold. */
function highlightMentions(body: string) {
  const parts = body.split(/(@[\p{L}\p{N}._-]+(?: [\p{Lu}][\p{L}\p{N}._-]*)?)/u);
  return parts.map((part, i) =>
    part.startsWith("@") ? (
      <strong key={i} className="font-semibold">
        {part}
      </strong>
    ) : (
      part
    ),
  );
}
