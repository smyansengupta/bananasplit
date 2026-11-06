import type { Citation, SuggestionSource, TargetRef } from "@/lib/crm/suggestions";
import type { TxClient } from "@/server/db/context";

import { personByEmail } from "./people";
import { saveDraft } from "./outreach/send";
import { proposeChange } from "./review";

/**
 * Where an AI-written email goes: an unsent draft in compose (outreach's
 * saveDraft, a DRAFT CrmEmailMessage for one person), opened with its
 * preview by the member it's for, who sends it themselves. Nothing here
 * ever sends. Every AI draft comes through this one function: the record's
 * "Draft a follow-up", the follow-up agent and a connected app's
 * crm_draft_email.
 *
 * A draft the member asked for themselves opens in their compose at once.
 * One that someone or something else wrote for them (the follow-up agent, a
 * connected app) also waits in Review, where "Open in compose" picks the
 * same draft up; sending it marks the suggestion done.
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
  /** The member asked for it and is there to open it: no Review suggestion. */
  inCompose?: boolean;
}

export interface Delivered {
  /** The unsent draft in compose, when it's for one person in the CRM. */
  draftId: string | null;
  personId: string | null;
  /** The Review suggestion, when someone else (an agent, an app) wrote it. */
  suggestionId: string | null;
}

/** The person a draft is for: the record itself, or whoever its first address belongs to. */
async function personFor(db: TxClient, organizationId: string, input: DraftInput): Promise<string | null> {
  if (input.target?.kind === "person") return input.target.id;
  const email = input.to[0];
  if (!email) return null;
  const p = await personByEmail(db, organizationId, email);
  return p && !p.deletedAt ? p.id : null;
}

export async function deliverDraft(db: TxClient, input: DraftInput): Promise<Delivered> {
  const owner = input.assigneeId ?? input.proposedById;
  const personId = await personFor(db, input.organizationId, input);
  const draft =
    owner && personId
      ? await saveDraft(db, {
          organizationId: input.organizationId,
          ownerId: owner,
          personId,
          subject: input.subject,
          body: input.body,
          createdById: input.proposedById,
        })
      : null;
  // Asked for by the member it's for: it's in their compose already.
  const askedThemselves = Boolean(draft && input.inCompose && input.proposedById && input.proposedById === owner);
  if (askedThemselves) return { draftId: draft!.draftId, personId, suggestionId: null };
  const { id } = await proposeChange(db, {
    organizationId: input.organizationId,
    kind: "DRAFT_EMAIL",
    source: input.source,
    title: input.title,
    summary: input.why ?? null,
    payload: { to: input.to, subject: input.subject, body: input.body, why: input.why ?? null, draftId: draft?.draftId ?? null },
    target: input.target ?? (personId ? { kind: "person", id: personId } : null),
    citation: input.citation ?? null,
    assigneeId: input.assigneeId,
    proposedById: input.proposedById,
  });
  return { draftId: draft?.draftId ?? null, personId, suggestionId: id };
}
