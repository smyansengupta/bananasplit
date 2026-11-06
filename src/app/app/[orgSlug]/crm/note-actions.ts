"use server";

import { z } from "zod";

import { requireUser } from "@/lib/auth/session";
import type { StoredIssue } from "@/lib/crm/issue";
import { parseStoredIssue } from "@/lib/crm/issue";
import type { NoteTaskDraft } from "@/lib/crm/note-task";
import { AiImportError } from "@/server/ai/generate";
import { AiCapError, NoAiConnectionError } from "@/server/crm/ai";
import { memberWho } from "@/server/crm/ai-tx";
import { refreshIssue, setIssueByHand } from "@/server/crm/issue";
import {
  createNoteTask,
  draftNoteTask,
  setNoteDeleted,
  undoNoteTask,
  updateNote,
} from "@/server/crm/note-task";

import { crmAction, toResult, type CrmResult } from "./run";

/**
 * The person and company cards' notes (docs/features/crm.md, "Notes and
 * tasks"): edit and delete a note (Undo restores it), turn a note or the
 * composer's Task channel into a task preview on the organization's AI,
 * make the task, take it back, and keep a person's biggest issue. The AI
 * ones read and write in short transactions around a call with none open
 * (src/server/crm/ai-tx.ts); the rest run in one transaction as the member.
 */

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const target = z.object({ kind: z.enum(["person", "company"]), id });

type AiCode = "no-connection" | "cap" | "limit";
type AiResult<T extends object> = ({ ok: true } & T) | { ok: false; error: string; code?: AiCode };

function aiFailure(error: unknown): { ok: false; error: string; code?: AiCode } {
  if (error instanceof NoAiConnectionError)
    return { ok: false, error: error.message, code: "no-connection" };
  if (error instanceof AiCapError) return { ok: false, error: error.message, code: "cap" };
  if (error instanceof AiImportError)
    return { ok: false, error: error.message, code: error.status === 429 ? "limit" : undefined };
  if (error instanceof z.ZodError) return { ok: false, error: "That wasn't a valid request." };
  return toResult(error);
}

async function who(organizationId: string) {
  const user = await requireUser();
  return memberWho(id.parse(organizationId), user.id);
}

// ---- Notes ----------------------------------------------------------------------------

const editNote = crmAction(async (ctx, _access, noteId: string, body: string) => {
  await updateNote(ctx, id.parse(noteId), z.string().max(20_000).parse(body));
  return {};
});
export async function updateNoteAction(
  orgId: string,
  noteId: string,
  body: string,
): Promise<CrmResult> {
  return editNote(orgId, noteId, body);
}

const trashNote = crmAction(async (ctx, _access, noteId: string, deleted: boolean) => {
  await setNoteDeleted(ctx, id.parse(noteId), z.boolean().parse(deleted));
  return {};
});
export async function deleteNoteAction(orgId: string, noteId: string): Promise<CrmResult> {
  return trashNote(orgId, noteId, true);
}
export async function restoreNoteAction(orgId: string, noteId: string): Promise<CrmResult> {
  return trashNote(orgId, noteId, false);
}

// ---- Notes to tasks ---------------------------------------------------------------------

/** The task preview: from a note on the record, or from text typed in the Task channel. */
export async function draftNoteTaskAction(
  orgId: string,
  input: {
    target: { kind: "person" | "company"; id: string };
    noteId?: string | null;
    text?: string | null;
  },
): Promise<AiResult<{ draft: NoteTaskDraft }>> {
  try {
    const parsed = z
      .object({
        target,
        noteId: id.nullable().optional(),
        text: z.string().max(8000).nullable().optional(),
      })
      .parse(input);
    const draft = await draftNoteTask(await who(orgId), parsed);
    return { ok: true, draft };
  } catch (error) {
    return aiFailure(error);
  }
}

const makeTask = crmAction(async (ctx, _access, input: unknown) => {
  const d = z
    .object({
      target,
      noteId: id.nullable(),
      title: z.string().max(400),
      description: z.string().max(20_000),
      ownerId: id.nullable(),
      dueDate: z.string().max(10).nullable(),
      priority: z.enum(["HIGH", "MEDIUM", "LOW"]),
    })
    .parse(input);
  const made = await createNoteTask(ctx, d);
  return { taskId: made.taskId, activityId: made.activityId, ownerName: made.ownerName };
});
export async function createNoteTaskAction(
  orgId: string,
  input: {
    target: { kind: "person" | "company"; id: string };
    noteId: string | null;
    title: string;
    description: string;
    ownerId: string | null;
    dueDate: string | null;
    priority: "HIGH" | "MEDIUM" | "LOW";
  },
): Promise<CrmResult<{ taskId: string; activityId: string; ownerName: string | null }>> {
  try {
    return await makeTask(orgId, input);
  } catch (error) {
    return aiFailure(error);
  }
}

const takeBack = crmAction(async (ctx, _access, taskId: string, activityId: string) => {
  await undoNoteTask(ctx, { taskId: id.parse(taskId), activityId: id.parse(activityId) });
  return {};
});
export async function undoNoteTaskAction(
  orgId: string,
  taskId: string,
  activityId: string,
): Promise<CrmResult> {
  return takeBack(orgId, taskId, activityId);
}

// ---- A person's biggest issue -------------------------------------------------------------

/** Reads it again now (the card's "Find it"), whether or not anything changed. */
export async function refreshIssueAction(
  orgId: string,
  personId: string,
): Promise<AiResult<{ issue: StoredIssue | null }>> {
  try {
    const r = await refreshIssue(await who(orgId), id.parse(personId), { force: true });
    return { ok: true, issue: r.issue };
  } catch (error) {
    return aiFailure(error);
  }
}

const saveIssue = crmAction(async (ctx, _access, personId: string, input: unknown) => {
  const pid = id.parse(personId);
  let issue: StoredIssue | null = null;
  if (input && typeof input === "object" && "restore" in input) {
    // Undo: the line as it was, with where it came from.
    issue = parseStoredIssue((input as { restore: unknown }).restore);
  } else if (input && typeof input === "object" && "text" in input) {
    const text = z
      .string()
      .max(300)
      .parse((input as { text: unknown }).text)
      .replace(/\s+/g, " ")
      .trim();
    issue = text
      ? { text: text.slice(0, 200), at: new Date().toISOString(), model: null, sources: [] }
      : null;
  }
  return { issue: await setIssueByHand(ctx.db, ctx.organizationId, pid, issue, ctx.userId) };
});
/** A member's own line, `null` to clear it, or `{ restore }` to put back what Undo took. */
export async function saveIssueAction(
  orgId: string,
  personId: string,
  input: { text: string } | { restore: StoredIssue } | null,
): Promise<CrmResult<{ issue: StoredIssue | null }>> {
  return saveIssue(orgId, personId, input);
}
