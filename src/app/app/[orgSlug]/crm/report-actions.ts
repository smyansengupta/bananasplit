"use server";

import { CrmError } from "@/server/crm/access";
import { updatePerson } from "@/server/crm/people";

import { crmAction } from "./run";

/**
 * The CRM reports' one ambient job: put the people going quiet in
 * tomorrow's Power hour (a follow-up tomorrow for each, none set before),
 * and take them back out (Undo).
 */

const MAX = 25;

export const queueQuietAction = crmAction(async (ctx, _a, personIds: string[]) => {
  if (personIds.length > MAX) throw new CrmError(`Up to ${MAX} at a time.`);
  const tomorrow = new Date(Date.now() + 86_400_000);
  const ids: string[] = [];
  for (const id of personIds) {
    const p = await ctx.db.crmPerson.findFirst({
      where: { id, organizationId: ctx.organizationId, deletedAt: null, nextFollowUpAt: null },
      select: { id: true },
    });
    if (!p) continue;
    await updatePerson(ctx, p.id, { nextFollowUpAt: tomorrow });
    ids.push(p.id);
  }
  return { ids };
});

export const unqueueQuietAction = crmAction(async (ctx, _a, personIds: string[]) => {
  if (personIds.length > MAX) throw new CrmError(`Up to ${MAX} at a time.`);
  for (const id of personIds) await updatePerson(ctx, id, { nextFollowUpAt: null });
  return {};
});
