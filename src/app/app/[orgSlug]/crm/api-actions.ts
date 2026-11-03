"use server";

import { CrmError } from "@/server/crm/access";
import { createApiKey, revokeApiKey } from "@/server/crm/api/keys";
import { createWebhook, deleteWebhook, sendTestDelivery, updateWebhook } from "@/server/crm/webhooks";

import { crmAction, crmGate, toResult, type CrmResult } from "./run";

/**
 * API keys and outgoing webhooks: owners and admins only (here, and in the
 * RLS on CrmApiKey and CrmWebhook). A new key and a new signing secret are
 * returned once, to show once.
 */

export const createApiKeyAction = crmAction(
  async (ctx, _a, input: { name: string; write: boolean }) => {
    try {
      return await createApiKey(ctx.db, ctx.organizationId, ctx.userId, { name: String(input.name ?? ""), write: Boolean(input.write) });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("An organization can have")) throw new CrmError(error.message);
      throw error;
    }
  },
  { admin: true },
);

export const revokeApiKeyAction = crmAction(
  async (ctx, _a, id: string) => {
    if (!(await revokeApiKey(ctx.db, ctx.organizationId, id))) throw new CrmError("That key was already revoked.");
    return {};
  },
  { admin: true },
);

export const createWebhookAction = crmAction(
  async (ctx, _a, input: { url: string; events: string[] }) =>
    createWebhook(ctx.db, ctx.organizationId, ctx.userId, { url: String(input.url ?? ""), events: input.events ?? [] }),
  { admin: true },
);

export const updateWebhookAction = crmAction(
  async (ctx, _a, id: string, input: { url?: string; events?: string[]; active?: boolean; rotateSecret?: boolean }) =>
    updateWebhook(ctx.db, ctx.organizationId, id, input),
  { admin: true },
);

export const deleteWebhookAction = crmAction(
  async (ctx, _a, id: string) => {
    await deleteWebhook(ctx.db, ctx.organizationId, id);
    return {};
  },
  { admin: true },
);

/** Shows a webhook's signing secret again (admins; RLS hides it from everyone else). */
export const webhookSecretAction = crmAction(
  async (ctx, _a, id: string) => {
    const hook = await ctx.db.crmWebhook.findFirst({ where: { id, organizationId: ctx.organizationId }, select: { signingSecret: true } });
    if (!hook) throw new CrmError("That webhook isn't here any more.");
    return { secret: hook.signingSecret };
  },
  { admin: true },
);

/** "Send test": a ping to one webhook, queued on the service path after the admin check commits. */
export async function sendTestWebhookAction(orgId: string, id: string): Promise<CrmResult> {
  try {
    const me = await crmGate(orgId);
    if (!me.admin) throw new CrmError("Only owners and admins can change this.");
    await sendTestDelivery(orgId, String(id), me.userId);
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}
