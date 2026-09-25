"use client";

import { formatDistanceToNow } from "date-fns";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";

import {
  addTaskComment,
  deleteTaskComment,
  editTaskComment,
  loadTaskComments,
} from "@/app/app/[orgSlug]/tasks/actions";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import type { TaskCommentItem } from "@/server/tasks/queries";

import { MentionTextarea } from "./mention-textarea";
import { TaskMarkdown } from "./task-markdown";
import { useTasks } from "./tasks-context";

/**
 * A task's comment thread: lazy-loaded a page at a time (newest page first,
 * 'Load earlier' for more), optimistic append (useOptimistic) while the
 * Server Action runs, @mentions through the member popover, and edit or
 * delete for the author or OWNER/ADMIN.
 */

interface PendingComment {
  id: string;
  body: string;
}

export function TaskComments({
  taskId,
  initial,
  audience,
}: {
  taskId: string;
  initial?: { comments: TaskCommentItem[]; hasMore: boolean };
  /** C4: on a private task, who may be mentioned in a comment. */
  audience?: readonly string[] | null;
}) {
  const { org, viewer, memberById, announce } = useTasks();
  const [comments, setComments] = useState<TaskCommentItem[]>(initial?.comments ?? []);
  const [hasMore, setHasMore] = useState(initial?.hasMore ?? false);
  const [loaded, setLoaded] = useState(Boolean(initial));
  const [body, setBody] = useState("");
  const [pending, addPending] = useOptimistic<PendingComment[], PendingComment>([], (state, c) => [
    ...state,
    c,
  ]);
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  async function reloadLatest() {
    const page = await loadTaskComments(org.id, taskId);
    if (page.error) return;
    setComments(page.comments);
    setHasMore(page.hasMore);
    setLoaded(true);
  }

  useEffect(() => {
    if (loaded) return;
    let cancelled = false;
    loadTaskComments(org.id, taskId).then((page) => {
      if (cancelled) return;
      setComments(page.comments);
      setHasMore(page.hasMore);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [loaded, org.id, taskId]);

  function loadEarlier() {
    const oldest = comments[0];
    if (!oldest) return;
    startTransition(async () => {
      const page = await loadTaskComments(org.id, taskId, oldest.id);
      setComments((current) => [...page.comments, ...current]);
      setHasMore(page.hasMore);
    });
  }

  function submit() {
    const text = body.trim();
    if (!text) return;
    setBody("");
    startTransition(async () => {
      addPending({ id: crypto.randomUUID(), body: text });
      const result = await addTaskComment(org.id, taskId, text);
      if (result.error) {
        announce(result.error);
        setBody(text);
        return;
      }
      await reloadLatest();
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: "nearest" }));
    });
  }

  function saveEdit() {
    if (!editing) return;
    const { id, body: text } = editing;
    startTransition(async () => {
      const result = await editTaskComment(org.id, id, text);
      if (result.error) {
        announce(result.error);
        return;
      }
      setEditing(null);
      setComments((current) =>
        current.map((c) => (c.id === id ? { ...c, body: text.trim(), editedAt: new Date() } : c)),
      );
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const result = await deleteTaskComment(org.id, id);
      if (result.error) {
        announce(result.error);
        return;
      }
      setComments((current) => current.filter((c) => c.id !== id));
    });
  }

  const me = memberById.get(viewer.userId);

  return (
    <section className="space-y-3" aria-label="Comments">
      {hasMore && (
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0"
          onClick={loadEarlier}
          disabled={isPending}
        >
          Load earlier comments
        </Button>
      )}
      {!loaded && <p className="text-muted-foreground text-sm">Loading comments…</p>}
      {loaded && comments.length === 0 && pending.length === 0 && (
        <p className="text-muted-foreground text-sm">No comments yet.</p>
      )}
      <ol className="space-y-3">
        {comments.map((c) => {
          const mine = c.authorId === viewer.userId;
          const canChange = mine || viewer.isAdmin;
          return (
            <li key={c.id} className="flex gap-2.5">
              <UserAvatar user={c.author} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                  <span className="text-foreground font-medium">{c.author.name ?? "Member"}</span>
                  <time
                    className="text-muted-foreground"
                    dateTime={new Date(c.createdAt).toISOString()}
                  >
                    {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
                  </time>
                  {c.editedAt && <span className="text-muted-foreground">(edited)</span>}
                  {canChange && editing?.id !== c.id && (
                    <span className="ml-auto flex gap-2">
                      {mine && (
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => setEditing({ id: c.id, body: c.body })}
                        >
                          Edit
                        </button>
                      )}
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => remove(c.id)}
                      >
                        Delete
                      </button>
                    </span>
                  )}
                </div>
                {editing?.id === c.id ? (
                  <div className="mt-1 space-y-2">
                    <MentionTextarea
                      aria-label="Edit comment"
                      value={editing.body}
                      rows={3}
                      onChange={(v) => setEditing({ id: c.id, body: v })}
                      onSubmitShortcut={saveEdit}
                      audience={audience}
                    />
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={saveEdit}
                        disabled={!editing.body.trim() || isPending}
                      >
                        Save comment
                      </Button>
                    </div>
                  </div>
                ) : (
                  <TaskMarkdown className="mt-0.5">{c.body}</TaskMarkdown>
                )}
              </div>
            </li>
          );
        })}
        {pending.map((c) => (
          <li key={c.id} className="flex gap-2.5 opacity-60" aria-busy="true">
            {me ? <UserAvatar user={me} size="sm" /> : <span className="size-6" />}
            <div className="min-w-0 flex-1">
              <div className="text-xs">
                <span className="font-medium">{me?.name ?? "You"}</span>{" "}
                <span className="text-muted-foreground">Sending…</span>
              </div>
              <TaskMarkdown className="mt-0.5">{c.body}</TaskMarkdown>
            </div>
          </li>
        ))}
      </ol>
      <div ref={endRef} />
      <div className="space-y-2">
        <MentionTextarea
          aria-label="Add a comment"
          placeholder="Add a comment. Type @ to mention someone."
          value={body}
          rows={2}
          onChange={setBody}
          onSubmitShortcut={submit}
          audience={audience}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs">Markdown works. Ctrl+Enter to send.</span>
          <Button size="sm" onClick={submit} disabled={!body.trim()}>
            Comment
          </Button>
        </div>
      </div>
    </section>
  );
}
