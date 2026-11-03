"use server";

import { refresh } from "next/cache";

import { createTasksFromImport } from "@/app/app/[orgSlug]/tasks/actions";
import { summaryToSend, todosToTurn, uncheckedTodos } from "@/lib/ambient/files";
import { spaceIncludes } from "@/lib/billing/space";
import { canEditNote, canShareNote } from "@/lib/notes/access";
import { withOrgAction } from "@/server/db/context";
import { linkedTaskTitles, meetingGoers } from "@/server/notes/ambient";
import { loadNote } from "@/server/notes/load";

import { shareNote } from "./actions";

/**
 * The note page's ambient buttons (Buttons3: Files and notes). Each one
 * checks the same rule the page showed it by (src/lib/ambient/files.ts),
 * as the member, so RLS applies, then does the job with the actions that
 * already do it: tasks through createTask, sending through shareNote.
 */

const filesAction: typeof withOrgAction = (handler, options) =>
  withOrgAction(handler, { onRefused: "return", ...options, feature: "files" });

type Result = { ok: true; count: number } | { ok: false; error: string };

const NOT_FOUND = "Note not found.";

/** The to-dos to turn into tasks: the note's unchecked ones not linked as tasks yet. */
const todosOf = filesAction(async (ctx, noteId: string) => {
  const org = await ctx.db.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { kind: true, plan: true, trialEndsAt: true, planAfterTrial: true },
  });
  if (!org || !spaceIncludes(org, "tasks")) return { error: "Tasks aren't on in this space." };
  const note = await loadNote(ctx, noteId);
  if (!note) return { error: NOT_FOUND };
  if (!canEditNote(ctx, note)) return { error: "Only people who can edit this note can do that." };
  const turn = todosToTurn(
    uncheckedTodos(note.contentJson),
    await linkedTaskTitles(ctx.db, ctx.organizationId, noteId),
  );
  return { todos: turn?.todos ?? [] };
});

/** Links each new task to the note, so it shows in both Linked panels (and isn't made twice). */
const linkTasks = filesAction(async (ctx, noteId: string, taskIds: string[]) => {
  await ctx.db.itemLink.createMany({
    data: taskIds.map((id) => ({
      organizationId: ctx.organizationId,
      fromKind: "note",
      fromId: noteId,
      toKind: "task",
      toId: id,
      createdById: ctx.userId,
    })),
    skipDuplicates: true,
  });
});

/** A week from today, as a date key (the server's own date is close enough for a default). */
function weekOut(): string {
  return new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
}

/** "Turn 3 to-dos into tasks": one task per unchecked to-do, linked back to the note. */
export async function turnTodosIntoTasksAction(orgId: string, noteId: string): Promise<Result> {
  const found = await todosOf(orgId, String(noteId ?? "").slice(0, 64));
  if ("error" in found && found.error) return { ok: false, error: found.error };
  const todos = "todos" in found ? (found.todos ?? []) : [];
  if (todos.length === 0) return { ok: false, error: "Every to-do here is a task already." };
  const make = (input: Record<string, string>) =>
    createTasksFromImport(
      orgId,
      todos.slice(0, 50).map((title, i) => ({ key: String(i), input: { title, ...input } })),
    );
  let { results } = await make({});
  // An organization that wants a date on every task: a week out, since the note gives none.
  if (results.every((r) => !r.taskId) && results.some((r) => /due date/i.test(r.error ?? ""))) {
    ({ results } = await make({ dueDate: weekOut() }));
  }
  const made = results.map((r) => r.taskId).filter((id): id is string => Boolean(id));
  if (made.length === 0) {
    return { ok: false, error: results.find((r) => r.error)?.error ?? "No tasks were made." };
  }
  await linkTasks(orgId, noteId, made);
  refresh();
  return { ok: true, count: made.length };
}

/** Who "Send the summary" sends to, and the meeting it's for. */
const summaryOf = filesAction(async (ctx, noteId: string) => {
  const note = await loadNote(ctx, noteId);
  if (!note) return { error: NOT_FOUND };
  if (!note.eventId) return { error: "This note isn't for a meeting." };
  const event = await ctx.db.event.findFirst({
    where: { id: note.eventId, organizationId: ctx.organizationId, deletedAt: null },
    select: { title: true, endsAt: true },
  });
  const shares = await ctx.db.noteShare.findMany({
    where: { organizationId: ctx.organizationId, noteId },
    select: { userId: true },
  });
  const send = summaryToSend({
    canShare: canShareNote(ctx, note),
    meetingEndsAt: event?.endsAt ?? null,
    now: new Date(),
    text: note.contentText,
    went: event ? await meetingGoers(ctx.db, ctx.organizationId, note.eventId) : [],
    sharedWith: shares.map((s) => s.userId),
    authorId: note.authorId,
    viewerId: ctx.userId,
  });
  return { userIds: send?.userIds ?? [], meeting: event?.title ?? null };
});

/**
 * "Send the summary": the notes go to everyone who went to the meeting and
 * hasn't had them (shared with them to view, with the usual notice, which
 * follows each person's email settings).
 */
export async function sendMeetingSummaryAction(orgId: string, noteId: string): Promise<Result> {
  const id = String(noteId ?? "").slice(0, 64);
  const found = await summaryOf(orgId, id);
  if ("error" in found && found.error) return { ok: false, error: found.error };
  const userIds = "userIds" in found ? (found.userIds ?? []) : [];
  if (userIds.length === 0) return { ok: false, error: "Everyone who went has these already." };
  const shared = await shareNote(orgId, id, {
    userIds: userIds.slice(0, 50),
    role: "VIEWER",
    message: found.meeting ? `Notes from ${found.meeting}.` : undefined,
  });
  if (shared.error) return { ok: false, error: shared.error };
  refresh();
  return { ok: true, count: Math.min(userIds.length, 50) };
}
