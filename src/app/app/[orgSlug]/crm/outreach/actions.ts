"use server";

import type { CrmShareMode, CrmTargetStatus } from "@/generated/prisma/client";
import { SNOOZES, type SnoozeKey } from "@/lib/crm/outreach/schedule";
import type { CrmDestination } from "@/lib/crm/outreach/form-map";
import type { Routing } from "@/lib/crm/outreach/assign";
import type { BookingQuestion } from "@/lib/crm/outreach/booking";
import { CrmError, requireManager } from "@/server/crm/access";
import { logActivity } from "@/server/crm/activity";
import { createPerson, updatePerson } from "@/server/crm/people";
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
import { saveList, type ListFilters } from "@/server/crm/outreach/lists";
import { checkSender } from "@/server/crm/outreach/mailbox";
import { saveMemberSettings } from "@/server/crm/outreach/member";
import {
  addDeliverable,
  createGuestLink,
  removeDeliverable,
  revokeGuestLink,
  setDeliverableDone,
  type DeliverableInput,
} from "@/server/crm/outreach/partners";
import { snoozeQueueItem } from "@/server/crm/outreach/queue";
import { ensureSelfUpdateLink, turnOffSelfUpdate } from "@/server/crm/outreach/self-update";
import { cancelEmail, composeEmail, type ComposeInput } from "@/server/crm/outreach/send";
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

/** A call, logged in one step from the queue or a record (the tel: link already dialled). */
export const logCallAction = outreachAction(
  async (ctx, _a, input: { personId: string; outcome: "talked" | "voicemail" | "no-answer"; note?: string; followUpDays?: number | null; stepId?: string | null }) => {
    const p = await ctx.db.crmPerson.findFirst({
      where: { id: input.personId, organizationId: ctx.organizationId },
      select: { id: true, companyId: true },
    });
    if (!p) throw new CrmError("That person isn't in the CRM any more.");
    const words = { talked: "Talked", voicemail: "Left a voicemail", "no-answer": "No answer" } as const;
    await logActivity(ctx.db, {
      organizationId: ctx.organizationId,
      kind: "CALL",
      direction: "OUTBOUND",
      subject: words[input.outcome] ?? "Call",
      body: input.note?.trim().slice(0, 5000) || null,
      targets: [{ kind: "person", id: p.id }, ...(p.companyId ? [{ kind: "company" as const, id: p.companyId }] : [])],
      actorId: ctx.userId,
      createdById: ctx.userId,
      meta: { outcome: input.outcome },
    });
    if (input.followUpDays !== undefined) {
      const at = input.followUpDays ? new Date(Date.now() + input.followUpDays * 86_400_000) : null;
      await updatePerson(ctx, p.id, { nextFollowUpAt: at }, { trusted: true });
    } else {
      // Reached them: a follow-up that was due is done.
      const person = await ctx.db.crmPerson.findFirst({ where: { id: p.id, organizationId: ctx.organizationId }, select: { nextFollowUpAt: true } });
      if (person?.nextFollowUpAt && person.nextFollowUpAt <= new Date() && input.outcome === "talked") {
        await updatePerson(ctx, p.id, { nextFollowUpAt: null }, { trusted: true });
      }
    }
    if (input.stepId) await closeStep(ctx.db, ctx.organizationId, input.stepId).catch(() => undefined);
    return {};
  },
);

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

export const saveFormDestinationAction = outreachAction(async (ctx, access, formId: string, dest: CrmDestination | null) => {
  if (!access.admin) throw new CrmError("Owners and admins set where a form's responses go.");
  await saveFormDestination(ctx, formId, dest);
  return {};
});

/** Accepts a person suggested from email: adds them (or turns it down). */
export const resolveSuggestionAction = outreachAction(async (ctx, _a, suggestionId: string, accept: boolean) => {
  const s = await ctx.db.crmSuggestion.findFirst({
    where: { id: suggestionId, organizationId: ctx.organizationId, status: "PENDING", kind: "CREATE_PERSON" },
    select: { id: true, payload: true },
  });
  if (!s) throw new CrmError("Someone already dealt with that.");
  let personId: string | null = null;
  if (accept) {
    const p = (s.payload ?? {}) as { email?: string; name?: string | null; title?: string | null; company?: string | null; phone?: string | null; companyId?: string | null };
    personId = (
      await createPerson(ctx, {
        name: p.name ?? null,
        primaryEmail: p.email ?? null,
        title: p.title ?? null,
        phone: p.phone ?? null,
        companyId: p.companyId ?? undefined,
        companyName: p.companyId ? undefined : (p.company ?? undefined),
        source: "email",
      })
    ).id;
  }
  await ctx.db.crmSuggestion.update({
    where: { id: s.id },
    data: { status: accept ? "ACCEPTED" : "REJECTED", reviewedById: ctx.userId, reviewedAt: new Date() },
  });
  return { personId };
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

export const addDeliverableAction = outreachAction(async (ctx, _a, dealId: string, input: DeliverableInput) => addDeliverable(ctx, dealId, input));

export const setDeliverableDoneAction = outreachAction(async (ctx, _a, id: string, done: boolean, proof?: string | null) => {
  await setDeliverableDone(ctx, id, done, proof);
  return {};
});

export const removeDeliverableAction = outreachAction(async (ctx, _a, id: string) => {
  await removeDeliverable(ctx, id);
  return {};
});

export const createGuestLinkAction = outreachAction(async (ctx, _a, dealId: string, expiresInDays: number | null) =>
  createGuestLink(ctx, dealId, expiresInDays),
);

export const revokeGuestLinkAction = outreachAction(async (ctx, _a, id: string) => {
  await revokeGuestLink(ctx, id);
  return {};
});

export const selfUpdateLinkAction = outreachAction(async (ctx, _a, personId: string, on: boolean) => {
  if (!on) {
    await turnOffSelfUpdate(ctx.db, ctx.organizationId, personId);
    return { url: null };
  }
  const url = await ensureSelfUpdateLink(ctx.db, ctx.organizationId, personId);
  if (!url) throw new CrmError("That person isn't in the CRM any more.");
  return { url };
});


