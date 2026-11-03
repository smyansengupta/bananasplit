import type { Citation, SuggestionSource, TargetRef } from "@/lib/crm/suggestions";
import type { TxClient } from "@/server/db/context";

import { proposeChange } from "./review";

/**
 * Where an AI-written email goes. Today: a DRAFT_EMAIL suggestion in the
 * review queue (accepting saves it as a draft on the record; nothing is ever
 * sent by AI). When the CRM's compose window lands (Phase 2), this one
 * function is what changes: every draft (the record's "Draft a follow-up",
 * the follow-up agent, a connected app's draft_email) comes through here.
 */

export interface DraftInput {
  organizationId: string;
  target: TargetRef | null;
  to: string[];
  subject: string;
  body: string;
  why?: string | null;
  title: string;
  source: SuggestionSource;
  citation?: Citation | null;
  proposedById: string | null;
  /** Who reviews it: the member who asked, or the record's owner for an agent. */
  assigneeId: string | null;
}

export async function deliverDraft(db: TxClient, input: DraftInput): Promise<{ suggestionId: string }> {
  const { id } = await proposeChange(db, {
    organizationId: input.organizationId,
    kind: "DRAFT_EMAIL",
    source: input.source,
    title: input.title,
    summary: input.why ?? null,
    payload: { to: input.to, subject: input.subject, body: input.body, why: input.why ?? null },
    target: input.target,
    citation: input.citation ?? null,
    assigneeId: input.assigneeId,
    proposedById: input.proposedById,
  });
  return { suggestionId: id };
}
