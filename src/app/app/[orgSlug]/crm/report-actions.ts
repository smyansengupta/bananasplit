"use server";

import { z } from "zod";

import { newBatchId } from "@/server/crm/history";
import { updatePerson } from "@/server/crm/people";

import { checkInput, crmAction } from "./run";

/**
 * The CRM reports' one ambient job: put the people going quiet in
 * tomorrow's Power hour (a follow-up tomorrow for each, none set before),
 * and take them back out (Undo).
 */

const MAX = 25;
const Ids = z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(MAX);

/** One read for all of them, then one batch of changes (one Undo, no Inbox line per person). */
export const queueQuietAction = crmAction(async (ctx, _a, personIds: string[]) => {
  const picked = [...new Set(checkInput(Ids, personIds, `Up to ${MAX} at a time.`))];
  const tomorrow = new Date(Date.now() + 86_400_000);
  const people = await ctx.db.crmPerson.findMany({
    where: { id: { in: picked }, organizationId: ctx.organizationId, deletedAt: null, nextFollowUpAt: null },
    select: { id: true },
  });
  const batchId = newBatchId();
  for (const p of people) await updatePerson(ctx, p.id, { nextFollowUpAt: tomorrow }, { batchId });
  return { ids: people.map((p) => p.id) };
});

export const unqueueQuietAction = crmAction(async (ctx, _a, personIds: string[]) => {
  const picked = [...new Set(checkInput(Ids, personIds, `Up to ${MAX} at a time.`))];
  const people = await ctx.db.crmPerson.findMany({
    where: { id: { in: picked }, organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true },
  });
  const batchId = newBatchId();
  for (const p of people) await updatePerson(ctx, p.id, { nextFollowUpAt: null }, { batchId });
  return {};
});
