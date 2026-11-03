"use server";

import { z } from "zod";

import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { requireUser } from "@/lib/auth/session";
import type { BriefData, TranscriptData } from "@/lib/crm/ai-outputs";
import { CrmValidationError } from "@/lib/crm/validate";
import { AiImportError } from "@/server/ai/generate";
import { CrmError, crmAccess, requireCrm, requireManager } from "@/server/crm/access";
import { AiCapError, NoAiConnectionError } from "@/server/crm/ai";
import { fillAiField, startColumnFill, type ColumnStart, type FillOutcome } from "@/server/crm/ai-fields";
import { memberWho } from "@/server/crm/ai-tx";
import { runFollowUpAgent, runResearchAgent, saveAgentSettings, type AgentSettings } from "@/server/crm/agents";
import { askCrm, type AskResponse } from "@/server/crm/ask";
import { tellCrm, type TellResponse } from "@/server/crm/tell";
import {
  draftFollowUp,
  meetingBrief,
  readConversation,
  readTranscript,
  summarizeRecord,
  TRANSCRIPT_SOURCES,
  type DraftResult,
} from "@/server/crm/assist";
import { saveDataKey, testDataKey, dataProvider, type ConnectResult, type DataProviderId } from "@/server/crm/data-connectors";
import { enrichRecord, type EnrichOutcome } from "@/server/crm/enrich";
import { acceptSuggestion, acceptSuggestions, rejectSuggestion, undoSuggestion } from "@/server/crm/review";
import { setAiCap, setEnrichmentOrder } from "@/server/crm/usage";
import { AppError } from "@/server/db/errors";
import { SpaceRefusedError, withOrgAction, withOrgTx, type OrgContext } from "@/server/db/context";
import { resolveActor } from "@/server/integrations/service";
import { removeSecret } from "@/server/secrets";

/**
 * The CRM's AI actions (Phase 4). The review queue's actions run in one
 * withOrgAction transaction as the member. The AI ones can't: the model is
 * called with no transaction open, so each reads and writes in its own
 * short transactions (src/server/crm/ai-tx.ts) around the call. Every
 * answer is { ok: true, ... } or { ok: false, error, code? } with words
 * for the person; "no-connection" and "cap" let the screen say what to do.
 */

export type AiResult<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string; code?: "no-connection" | "cap" | "limit" };

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const kindSchema = z.enum(["person", "company", "deal"]);

function failure(error: unknown): { ok: false; error: string; code?: "no-connection" | "cap" | "limit" } {
  if (error instanceof NoAiConnectionError) return { ok: false, error: error.message, code: "no-connection" };
  if (error instanceof AiCapError) return { ok: false, error: error.message, code: "cap" };
  if (error instanceof AiImportError) return { ok: false, error: error.message, code: error.status === 429 ? "limit" : undefined };
  if (error instanceof CrmError || error instanceof CrmValidationError) return { ok: false, error: error.message };
  if (error instanceof SpaceRefusedError) return { ok: false, error: error.message };
  if (error instanceof ForbiddenError) return { ok: false, error: "You can't change that." };
  if (error instanceof NotFoundError) return { ok: false, error: "That isn't here any more." };
  if (error instanceof z.ZodError) return { ok: false, error: "That wasn't a valid request." };
  if (error instanceof AppError) return { ok: false, error: error.message };
  console.error("[crm-ai] action failed", error instanceof Error ? error.message : error);
  return { ok: false, error: "That didn't work. Try again." };
}

async function run<T extends object>(fn: () => Promise<T>): Promise<AiResult<T>> {
  try {
    return { ok: true, ...(await fn()) } as AiResult<T>;
  } catch (error) {
    return failure(error);
  }
}

/** A review-queue action: one transaction as the member, the CRM's gate first. */
function queueAction<Args extends unknown[], T extends object>(handler: (ctx: OrgContext, ...args: Args) => Promise<T>) {
  const inner = withOrgAction(
    async (ctx: OrgContext, ...args: Args) => {
      await requireCrm(ctx);
      return handler(ctx, ...args);
    },
    { feature: "crm" },
  );
  return (organizationId: string, ...args: Args) => run(() => inner(organizationId, ...args));
}

/** The member (signed in) for an AI action. */
async function who(organizationId: string) {
  const user = await requireUser();
  return memberWho(id.parse(organizationId), user.id);
}

// ---- The review queue -------------------------------------------------------------

const acceptOne = queueAction(async (ctx, suggestionId: string, edits?: unknown) => {
  const r = await acceptSuggestion(ctx, id.parse(suggestionId), edits);
  return { createdId: r.applied.createdId ?? null, createdKind: r.applied.createdKind ?? null };
});
export async function acceptSuggestionAction(orgId: string, suggestionId: string, edits?: unknown) {
  return acceptOne(orgId, suggestionId, edits);
}

const rejectOne = queueAction(async (ctx, suggestionId: string) => {
  await rejectSuggestion(ctx, id.parse(suggestionId));
  return {};
});
export async function rejectSuggestionAction(orgId: string, suggestionId: string) {
  return rejectOne(orgId, suggestionId);
}

const acceptMany = queueAction(async (ctx, ids: string[]) => acceptSuggestions(ctx, z.array(id).max(200).parse(ids)));
export async function acceptAllAction(orgId: string, ids: string[]) {
  return acceptMany(orgId, ids);
}

const rejectMany = queueAction(async (ctx, ids: string[]) => {
  let rejected = 0;
  for (const s of z.array(id).max(200).parse(ids)) {
    await rejectSuggestion(ctx, s);
    rejected++;
  }
  return { rejected };
});
export async function rejectAllAction(orgId: string, ids: string[]) {
  return rejectMany(orgId, ids);
}

const undoOne = queueAction(async (ctx, suggestionId: string) => {
  await undoSuggestion(ctx, id.parse(suggestionId));
  return {};
});
export async function undoSuggestionAction(orgId: string, suggestionId: string) {
  return undoOne(orgId, suggestionId);
}

// ---- On a record ------------------------------------------------------------------

export async function summarizeAction(orgId: string, kind: string, recordId: string): Promise<AiResult<{ text: string; points: string[]; at: string }>> {
  return run(async () => {
    const s = await summarizeRecord(await who(orgId), { kind: kindSchema.parse(kind), id: id.parse(recordId) });
    return { text: s.text, points: s.points, at: s.at };
  });
}

export async function draftFollowUpAction(orgId: string, kind: string, recordId: string, purpose?: string): Promise<AiResult<DraftResult>> {
  return run(async () => draftFollowUp(await who(orgId), { kind: kindSchema.parse(kind), id: id.parse(recordId) }, z.string().max(1000).optional().parse(purpose)));
}

export async function briefAction(orgId: string, kind: string, recordId: string): Promise<AiResult<BriefData & { at: string }>> {
  return run(async () => meetingBrief(await who(orgId), { kind: kindSchema.parse(kind), id: id.parse(recordId) }));
}

const transcriptInput = z.object({
  text: z.string().min(1).max(200_000),
  source: z.enum(TRANSCRIPT_SOURCES).default("pasted"),
  title: z.string().max(200).nullish(),
  meetingDay: z.string().max(10).nullish(),
  kind: z.enum(["MEETING", "CALL"]).default("MEETING"),
});

export async function transcriptAction(
  orgId: string,
  kind: string,
  recordId: string,
  input: z.input<typeof transcriptInput>,
): Promise<AiResult<{ reading: TranscriptData; queued: number }>> {
  return run(async () => readTranscript(await who(orgId), { target: { kind: kindSchema.parse(kind), id: id.parse(recordId) }, ...transcriptInput.parse(input) }));
}

export async function enrichAction(orgId: string, kind: string, recordId: string): Promise<AiResult<EnrichOutcome>> {
  return run(async () => {
    const k = kindSchema.parse(kind);
    if (k === "deal") throw new CrmError("Enrichment is for people and companies.");
    return enrichRecord(await who(orgId), { kind: k, id: id.parse(recordId) });
  });
}

export async function researchAction(orgId: string, kind: string, recordId: string): Promise<AiResult<{ status: string }>> {
  return run(async () => {
    const k = kindSchema.parse(kind);
    if (k === "deal") throw new CrmError("The research agent looks into people and companies.");
    return { status: await runResearchAgent(await who(orgId), { kind: k, id: id.parse(recordId) }) };
  });
}

// ---- Anywhere in the CRM ----------------------------------------------------------

export async function askAction(orgId: string, question: string): Promise<AiResult<AskResponse>> {
  return run(async () => askCrm(await who(orgId), z.string().max(500).parse(question)));
}

export async function conversationTextAction(
  orgId: string,
  text: string,
  personId?: string | null,
): Promise<AiResult<{ matched: { id: string; name: string } | null; queued: number; summary: string; notes: string[] }>> {
  return run(async () => {
    const r = await readConversation(await who(orgId), { text: z.string().max(20_000).parse(text), personId: personId ? id.parse(personId) : null });
    return { matched: r.matched, queued: r.queued, summary: r.reading.summary, notes: r.reading.notes };
  });
}

/** A change said in words, queued (not applied) for the Ask card to preview: Apply, Cancel, Undo. */
export async function tellAction(orgId: string, text: string): Promise<AiResult<TellResponse>> {
  return run(async () => tellCrm(await who(orgId), z.string().max(500).parse(text)));
}

export interface PastedItem {
  id: string;
  kind: "person" | "timeline" | "step";
  title: string;
  text: string;
}

/** A pasted chat, read into suggestions the Ask card lists with checkboxes (Add N people). */
export async function pasteAction(
  orgId: string,
  text: string,
): Promise<AiResult<{ matched: { id: string; name: string } | null; summary: string; items: PastedItem[] }>> {
  return run(async () => {
    const w = await who(orgId);
    const r = await readConversation(w, { text: z.string().max(20_000).parse(text) });
    const rows = await w.tx((actor) =>
      actor.db.crmSuggestion.findMany({
        where: { organizationId: w.organizationId, id: { in: r.ids }, status: "PENDING" },
        select: { id: true, kind: true, title: true, summary: true, payload: true },
      }),
    );
    const items: PastedItem[] = [];
    for (const id of r.ids) {
      const s = rows.find((x) => x.id === id);
      if (!s) continue;
      const p = (s.payload ?? {}) as Record<string, unknown>;
      if (s.kind === "CREATE_PERSON") {
        const person = (p.person ?? {}) as { name?: string; title?: string | null; companyName?: string | null; primaryEmail?: string | null };
        const task = p.task as { title?: string; dueDate?: string | null } | null | undefined;
        const role = [person.title, person.companyName].filter(Boolean).join(", ");
        items.push({
          id: s.id,
          kind: "person",
          title: person.name ?? s.title,
          text: [role ? `${role}.` : null, person.primaryEmail ?? null, task?.title ? `Next step: ${task.title}${task.dueDate ? `, by ${task.dueDate}` : ""}` : null]
            .filter(Boolean)
            .join(" "),
        });
      } else if (s.kind === "CREATE_TASK") {
        const due = typeof p.dueDate === "string" ? p.dueDate : null;
        items.push({ id: s.id, kind: "step", title: String(p.title ?? s.title), text: due ? `For you, by ${due}` : "For you" });
      } else {
        items.push({ id: s.id, kind: "timeline", title: s.title, text: s.summary ?? "" });
      }
    }
    return { matched: r.matched, summary: r.reading.summary, items };
  });
}

export async function followUpAgentAction(orgId: string, days?: number): Promise<AiResult<{ drafted: number }>> {
  return run(async () => {
    const r = await runFollowUpAgent(await who(orgId), { days: z.number().int().min(7).max(365).optional().parse(days) });
    return { drafted: r.drafted };
  });
}

// ---- AI fields --------------------------------------------------------------------

export async function fillAiFieldAction(orgId: string, fieldId: string, recordId: string): Promise<AiResult<FillOutcome>> {
  return run(async () => fillAiField(await who(orgId), id.parse(fieldId), id.parse(recordId)));
}

export async function fillColumnAction(orgId: string, fieldId: string, onlyEmpty: boolean): Promise<AiResult<ColumnStart>> {
  return run(async () => {
    const w = await who(orgId);
    const access = await withOrgTx(w.organizationId, (ctx) => crmAccess(ctx));
    requireManager(access);
    return startColumnFill(w, id.parse(fieldId), { onlyEmpty: onlyEmpty !== false });
  });
}

// ---- Settings ---------------------------------------------------------------------

const capAction = queueAction(async (ctx, dollars: number | null) => {
  const access = await crmAccess(ctx);
  const cents = await setAiCap({ ...ctx, admin: access.admin }, dollars === null ? null : z.number().parse(dollars));
  return { capCents: cents };
});
export async function setAiCapAction(orgId: string, dollars: number | null) {
  return capAction(orgId, dollars);
}

const orderAction = queueAction(async (ctx, order: string[]) => {
  requireManager(await crmAccess(ctx));
  return { order: await setEnrichmentOrder(ctx, z.array(z.string().max(20)).max(10).parse(order)) };
});
export async function setEnrichmentOrderAction(orgId: string, order: string[]) {
  return orderAction(orgId, order);
}

const agentsAction = queueAction(async (ctx, input: Partial<AgentSettings>) => {
  requireManager(await crmAccess(ctx));
  const parsed = z
    .object({ researchNew: z.boolean().optional(), followUp: z.boolean().optional(), followUpDays: z.number().int().min(7).max(365).optional() })
    .parse(input);
  return { settings: await saveAgentSettings(ctx, parsed) };
});
export async function saveAgentSettingsAction(orgId: string, input: Partial<AgentSettings>) {
  return agentsAction(orgId, input);
}

// ---- Data connectors (Integrations and apps) ---------------------------------------

const providerSchema = z.enum(["tavily", "hunter", "prospeo"]);

async function connectorRun(orgId: string, fn: (actor: Awaited<ReturnType<typeof resolveActor>>) => Promise<ConnectResult>): Promise<ConnectResult> {
  try {
    const actor = await resolveActor(id.parse(orgId));
    return await fn(actor);
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: error.message };
    if (error instanceof NotFoundError) return { ok: false, error: "Not found." };
    if (error instanceof z.ZodError) return { ok: false, error: "Invalid input." };
    throw error;
  }
}

export async function saveDataKeyAction(orgId: string, provider: string, apiKey: string): Promise<ConnectResult> {
  return connectorRun(orgId, (actor) => saveDataKey(orgId, actor, providerSchema.parse(provider) as DataProviderId, z.string().max(600).parse(apiKey)));
}

export async function testDataKeyAction(orgId: string, provider: string): Promise<ConnectResult> {
  return connectorRun(orgId, (actor) => testDataKey(orgId, actor, providerSchema.parse(provider) as DataProviderId));
}

export async function removeDataKeyAction(orgId: string, provider: string): Promise<ConnectResult> {
  return connectorRun(orgId, async (actor) => {
    const info = dataProvider(providerSchema.parse(provider));
    if (!info) return { ok: false, error: "Pick one of the listed providers." };
    const removed = await removeSecret({ orgId, actor, provider: info.provider });
    return { ok: true, message: removed ? `Removed. The ${info.label} key was deleted.` : "Nothing was stored." };
  });
}
