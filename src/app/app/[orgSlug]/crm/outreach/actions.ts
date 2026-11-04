"use server";

import { z } from "zod";

import type { CrmShareMode, CrmTargetStatus } from "@/generated/prisma/client";
import { SNOOZES, type SnoozeKey } from "@/lib/crm/outreach/schedule";
import type { CrmDestination } from "@/lib/crm/outreach/form-map";
import type { Routing } from "@/lib/crm/outreach/assign";
import type { BookingQuestion } from "@/lib/crm/outreach/booking";
import type { Audience, PlanFrom } from "@/lib/crm/outreach/plans";
import { CrmError, requireManager } from "@/server/crm/access";
import { logActivity } from "@/server/crm/activity";
import { newBatchId } from "@/server/crm/history";
import { updatePerson } from "@/server/crm/people";
import { acceptSuggestion, rejectSuggestion } from "@/server/crm/review";
import { rolePositions } from "@/server/crm/owners";
import { createBookingPage, updateBookingPage, type BookingPageInput } from "@/server/crm/outreach/booking";
import { planBulk, sendBulk } from "@/server/crm/outreach/bulk-email";
import {
  createCampaign,
  enrollShare,
  rebalance,
  reassign,
  refreshFromList,
  sendShare,
  setCampaignStatus,
  setTargetStatus,
  type CampaignInput,
  type ShareItem,
} from "@/server/crm/outreach/campaigns";
import { handOver } from "@/server/crm/outreach/handover";
import { saveFormDestination, saveOrgRouting } from "@/server/crm/outreach/intake";
import { listPeople, saveList, type ListFilters } from "@/server/crm/outreach/lists";
import { checkSender } from "@/server/crm/outreach/mailbox";
import { savePlanExtras, startPlan } from "@/server/crm/outreach/plans";
import { saveMemberSettings } from "@/server/crm/outreach/member";
import { snoozeQueueItem } from "@/server/crm/outreach/queue";
import { ensureSelfUpdateLink, turnOffSelfUpdate } from "@/server/crm/outreach/self-update";
import { cancelEmail, composeEmail, contactable, discardDraft, type ComposeInput } from "@/server/crm/outreach/send";
import { composeTemplates } from "@/server/crm/outreach/view";
import {
  archiveSequence,
  closeStep,
  createSequence,
  enroll,
  saveSequence,
  setSequenceStatus,
  stopEnrollment,
  type SequenceInput,
} from "@/server/crm/outreach/sequences";
import { archiveTemplate, createTemplate, previewFor, updateTemplate, type TemplateInput } from "@/server/crm/outreach/templates";

import { outreachAction } from "./crm-action";

/**
 * Reaching out (docs/features/crm.md, Phase 2): every outreach action, each
 * one withOrgAction transaction as the member (RLS decides), answering
 * { ok: true, ... } or { ok: false, error }. Mail is only ever queued here;
 * the crm-send and crm-sequence jobs send it after commit.
 */

// ---- Email ----------------------------------------------------------------------

export const composeEmailAction = outreachAction(async (ctx, _access, input: ComposeInput) => {
  const r = await composeEmail(ctx, input);
  return "conflict" in r ? { conflict: { ...r.conflict, at: r.conflict.at?.toISOString() ?? null } } : { messageId: r.messageId };
});

/** Throws an unsent draft away. */
export const discardDraftAction = outreachAction(async (ctx, _a, draftId: string) => {
  await discardDraft(ctx.db, ctx.organizationId, draftId);
  return {};
});

/** An unsent draft, ready for compose: its words, who it's for and the templates. */
export const openDraftAction = outreachAction(async (ctx, _a, draftId: string) => {
  const d = await ctx.db.crmEmailMessage.findFirst({
    where: { id: draftId, organizationId: ctx.organizationId, status: "DRAFT" },
    select: { id: true, subject: true, bodyText: true, personId: true },
  });
  if (!d?.personId) throw new CrmError("That draft was sent or thrown away.");
  const p = await ctx.db.crmPerson.findFirst({
    where: { id: d.personId, organizationId: ctx.organizationId },
    select: { id: true, name: true, primaryEmail: true, doNotContact: true, unsubscribedAt: true, consent: true, deletedAt: true },
  });
  if (!p) throw new CrmError("That person isn't in the CRM any more.");
  const can = contactable(p);
  return {
    draft: { id: d.id, subject: d.subject ?? "", body: d.bodyText ?? "" },
    person: { id: p.id, name: p.name, email: p.primaryEmail, blocked: can.ok ? null : can.reason },
    templates: await composeTemplates(ctx.db, ctx.organizationId),
  };
});

export const cancelEmailAction = outreachAction(async (ctx, _a, messageId: string) => {
  await cancelEmail(ctx, messageId);
  return {};
});

export const previewAction = outreachAction(async (ctx, _a, text: { subject: string; body: string }, personIds: string[]) => ({
  rows: await previewFor(ctx, text, personIds),
}));

// ---- Templates ---------------------------------------------------------------------

export const saveTemplateAction = outreachAction(async (ctx, _a, id: string | null, input: TemplateInput) => {
  if (id) {
    await updateTemplate(ctx, id, input);
    return { id };
  }
  return createTemplate(ctx, input);
});

export const archiveTemplateAction = outreachAction(async (ctx, _a, id: string) => {
  await archiveTemplate(ctx, id);
  return {};
});

// ---- Sequences ---------------------------------------------------------------------

export const createSequenceAction = outreachAction(async (ctx, _a, name: string) => createSequence(ctx, name));

export const saveSequenceAction = outreachAction(async (ctx, _a, id: string, input: SequenceInput) => {
  await saveSequence(ctx, id, input);
  return {};
});

export const setSequenceStatusAction = outreachAction(async (ctx, _a, id: string, status: "ON" | "OFF") => {
  await setSequenceStatus(ctx, id, status);
  return {};
});

export const archiveSequenceAction = outreachAction(async (ctx, _a, id: string) => {
  await archiveSequence(ctx, id);
  return {};
});

export const enrollAction = outreachAction(
  async (ctx, _a, sequenceId: string, personIds: string[], confirmConflicts: boolean) =>
    enroll(ctx, sequenceId, personIds, { confirmConflicts }),
);

export const stopEnrollmentAction = outreachAction(async (ctx, _a, enrollmentId: string) => {
  await stopEnrollment(ctx, enrollmentId);
  return {};
});

// ---- Plans (a sequence as the Outreach tab shows it) ---------------------------------

/** A new plan: a draft sequence with an email and a follow-up, ready to edit. */
export const createPlanAction = outreachAction(async (ctx, _a, name?: string) => {
  const parsed = z.string().max(120).optional().safeParse(name);
  if (!parsed.success) throw new CrmError("Keep the name under 120 characters.", ["name"]);
  return createSequence(ctx, parsed.data?.trim() || "New plan");
});

export interface PlanSettingsInput {
  from?: PlanFrom;
  dailyCap?: number | null;
  who?: Audience;
  include?: string[];
  stopOnReply?: boolean;
}

/** A plan's settings and who it's for (its sender, daily cap, stop on reply, audience). */
export const savePlanSettingsAction = outreachAction(async (ctx, _a, id: string, input: PlanSettingsInput) => {
  if (input.dailyCap !== undefined && input.dailyCap !== null && (!Number.isInteger(input.dailyCap) || input.dailyCap < 1 || input.dailyCap > 2000)) {
    throw new CrmError("Pick between 1 and 2,000 a day.");
  }
  if (input.from !== undefined && input.from !== "owner" && input.from !== "me") throw new CrmError("Pick who sends it.");
  const patch: Parameters<typeof savePlanExtras>[2] = {};
  if (input.from !== undefined) patch.from = input.from;
  if (input.dailyCap !== undefined) patch.dailyCap = input.dailyCap;
  if (input.who !== undefined) patch.who = input.who;
  if (input.include !== undefined) patch.include = input.include;
  const extras = await savePlanExtras(ctx, id, patch);
  if (input.stopOnReply !== undefined) {
    await saveSequence(ctx, id, { stopOnReply: input.stopOnReply, stopOnBooking: input.stopOnReply });
  }
  return { extras };
});

/** Starts a plan: on, and everyone it's for who isn't left out goes in. */
export const startPlanAction = outreachAction(async (ctx, _a, id: string) => startPlan(ctx, id, await rolePositions(ctx.organizationId)));

// ---- Lists and campaigns ----------------------------------------------------------------

export const saveListAction = outreachAction(async (ctx, _a, name: string, filters: ListFilters) => saveList(ctx, name, filters));

export const createCampaignAction = outreachAction(async (ctx, _a, input: CampaignInput) =>
  createCampaign(ctx, input, await rolePositions(ctx.organizationId)),
);

export const refreshCampaignAction = outreachAction(async (ctx, _a, campaignId: string) => ({
  added: await refreshFromList(ctx, campaignId, await rolePositions(ctx.organizationId)),
}));

export const reassignAction = outreachAction(async (ctx, _a, campaignId: string, targetIds: string[], memberIds: string[]) => {
  await reassign(ctx, campaignId, targetIds, memberIds);
  return {};
});

export const rebalanceAction = outreachAction(async (ctx, _a, campaignId: string, memberIds: string[]) => {
  await rebalance(ctx, campaignId, memberIds);
  return {};
});

export const setTargetStatusAction = outreachAction(async (ctx, _a, targetId: string, status: CrmTargetStatus) => {
  if (!["TODO", "CONTACTED", "REPLIED", "BOOKED", "CONVERTED", "SKIPPED"].includes(status)) throw new CrmError("Pick a status.");
  await setTargetStatus(ctx, targetId, status);
  return {};
});

export const setCampaignStatusAction = outreachAction(async (ctx, _a, campaignId: string, status: "ACTIVE" | "DONE" | "ARCHIVED") => {
  await setCampaignStatus(ctx, campaignId, status);
  return {};
});

export const sendShareAction = outreachAction(async (ctx, _a, campaignId: string, items: ShareItem[]) => sendShare(ctx, campaignId, items));

export const enrollShareAction = outreachAction(async (ctx, _a, campaignId: string) => enrollShare(ctx, campaignId));

export const keepInTouchAction = outreachAction(async (ctx, _a, personIds: string[], days: number | null) => {
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 730)) throw new CrmError("Pick how often.");
  const ids = [...new Set(personIds)].slice(0, 2000);
  let changed = 0;
  for (const id of ids) {
    const r = await updatePerson(ctx, id, { keepInTouchDays: days }, { trusted: true, batchId: null });
    if (r.changed.length) changed++;
  }
  return { changed };
});

/** Keep in touch, in bulk, for everyone on a list (each change undoable from history). */
export const keepInTouchListAction = outreachAction(async (ctx, _a, viewId: string, days: number | null) => {
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 730)) throw new CrmError("Pick how often.");
  const people = await listPeople(ctx.db, ctx.organizationId, viewId, ctx.userId, await rolePositions(ctx.organizationId), 2000);
  const batchId = newBatchId();
  let changed = 0;
  for (const p of people) {
    const r = await updatePerson(ctx, p.id, { keepInTouchDays: days }, { trusted: true, batchId });
    if (r.changed.length) changed++;
  }
  return { changed, batchId };
});

// ---- Bulk email ---------------------------------------------------------------------

export const planBulkAction = outreachAction(async (ctx, _a, viewId: string) => ({
  plan: await planBulk(ctx, viewId, await rolePositions(ctx.organizationId)),
  sender: await checkSender(ctx.organizationId),
}));

export const sendBulkAction = outreachAction(async (ctx, access, input: { viewId: string; subject: string; body: string; templateId?: string | null }) =>
  sendBulk(ctx, access, await checkSender(ctx.organizationId), input, await rolePositions(ctx.organizationId)),
);

// ---- The queue ---------------------------------------------------------------------------

export const snoozeAction = outreachAction(async (ctx, _a, id: string, choice: SnoozeKey) => {
  const s = SNOOZES[choice];
  if (!s) throw new CrmError("Pick when.");
  const until = new Date();
  until.setUTCDate(until.getUTCDate() + s.days);
  until.setUTCHours(12, 0, 0, 0);
  await snoozeQueueItem(ctx, id, until);
  return { until: until.toISOString() };
});

/** A note or an email sent elsewhere, logged from the queue: it also clears a follow-up that was due. */
export const logTouchAction = outreachAction(
  async (ctx, _a, input: { personId: string; kind: "NOTE" | "EMAIL" | "TEXT" | "MEETING"; note: string; followUpDays?: number | null }) => {
    if (!["NOTE", "EMAIL", "TEXT", "MEETING"].includes(input.kind)) throw new CrmError("Pick what happened.");
    if (!input.note.trim()) throw new CrmError("Write what happened.");
    const p = await ctx.db.crmPerson.findFirst({
      where: { id: input.personId, organizationId: ctx.organizationId },
      select: { id: true, companyId: true, nextFollowUpAt: true },
    });
    if (!p) throw new CrmError("That person isn't in the CRM any more.");
    await logActivity(ctx.db, {
      organizationId: ctx.organizationId,
      kind: input.kind,
      direction: input.kind === "NOTE" ? null : "OUTBOUND",
      subject: input.note.trim().split("\n")[0]!.slice(0, 200),
      body: input.note.trim().slice(0, 5000),
      targets: [{ kind: "person", id: p.id }, ...(p.companyId ? [{ kind: "company" as const, id: p.companyId }] : [])],
      actorId: ctx.userId,
      createdById: ctx.userId,
    });
    const at =
      input.followUpDays === undefined
        ? p.nextFollowUpAt && p.nextFollowUpAt <= new Date() && input.kind !== "NOTE"
          ? null
          : undefined
        : input.followUpDays
          ? new Date(Date.now() + input.followUpDays * 86_400_000)
          : null;
    if (at !== undefined) await updatePerson(ctx, p.id, { nextFollowUpAt: at }, { trusted: true });
    return {};
  },
);

export const closeStepAction = outreachAction(async (ctx, _a, activityId: string) => {
  await closeStep(ctx.db, ctx.organizationId, activityId);
  return {};
});

export const setFollowUpAction = outreachAction(async (ctx, _a, personId: string, days: number | null) => {
  await updatePerson(ctx, personId, { nextFollowUpAt: days ? new Date(Date.now() + days * 86_400_000) : null });
  return {};
});

// ---- Booking pages ------------------------------------------------------------------------

export const createBookingPageAction = outreachAction(async (ctx, _a, title: string) => createBookingPage(ctx, title));

export const saveBookingPageAction = outreachAction(async (ctx, _a, id: string, input: BookingPageInput & { questions?: BookingQuestion[] }) => {
  await updateBookingPage(ctx, id, input);
  return {};
});

// ---- Your settings, routing, forms -----------------------------------------------------------

export const saveMemberSettingsAction = outreachAction(
  async (ctx, _a, input: { shareMode?: CrmShareMode; neverLog?: string; signature?: string | null; newBccAddress?: boolean }) => ({
    settings: await saveMemberSettings(ctx, input),
  }),
);

export const saveRoutingAction = outreachAction(async (ctx, access, routing: Routing) => {
  await saveOrgRouting(ctx, access, routing);
  return {};
});

export const saveDailyCapAction = outreachAction(async (ctx, access, cap: number) => {
  requireManager(access);
  if (!Number.isInteger(cap) || cap < 10 || cap > 2000) throw new CrmError("Pick between 10 and 2,000.");
  await ctx.db.crmSettings.update({ where: { organizationId: ctx.organizationId }, data: { dailySendCap: cap } });
  return {};
});

export const saveFormDestinationAction = outreachAction(async (ctx, access, formId: string, dest: CrmDestination | null) => {
  if (!access.admin) throw new CrmError("Owners and admins set where a form's responses go.");
  await saveFormDestination(ctx, formId, dest);
  return {};
});

/** A person suggested from email (one review queue: the same suggestion as in Review). */
export const resolveSuggestionAction = outreachAction(async (ctx, _a, suggestionId: string, accept: boolean) => {
  if (!accept) {
    await rejectSuggestion(ctx, suggestionId);
    return { personId: null };
  }
  const r = await acceptSuggestion(ctx, suggestionId);
  return { personId: r.applied.createdKind === "person" ? (r.applied.createdId ?? null) : null };
});

// ---- Handover -------------------------------------------------------------------------------

export const handOverAction = outreachAction(
  async (ctx, access, input: { fromUserId: string; to: string; personIds?: string[] }) => {
    requireManager(access);
    const roles = await rolePositions(ctx.organizationId);
    const to = input.to.startsWith("r:") ? { toRoleKey: input.to.slice(2) } : { toUserId: input.to.replace(/^u:/, "") };
    return handOver(ctx, access, { fromUserId: input.fromUserId, personIds: input.personIds, ...to }, roles);
  },
);

/** Gives people without an owner to a member or a position. */
export const giveOwnerAction = outreachAction(async (ctx, _a, personIds: string[], to: string) => {
  const owner = to.startsWith("r:") ? { ownerId: null, ownerRoleKey: to.slice(2) } : { ownerId: to.replace(/^u:/, ""), ownerRoleKey: null };
  let changed = 0;
  for (const id of [...new Set(personIds)].slice(0, 500)) {
    if ((await updatePerson(ctx, id, owner)).changed.length) changed++;
  }
  return { changed };
});

// ---- What we owe them, guest links, self-update -----------------------------------------------------

export const selfUpdateLinkAction = outreachAction(async (ctx, _a, personId: string, on: boolean) => {
  if (!on) {
    await turnOffSelfUpdate(ctx.db, ctx.organizationId, personId);
    return { url: null };
  }
  const url = await ensureSelfUpdateLink(ctx.db, ctx.organizationId, personId);
  if (!url) throw new CrmError("That person isn't in the CRM any more.");
  return { url };
});


