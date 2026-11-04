"use server";

import { z } from "zod";

import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { ORG_KEY_IDS } from "@/lib/crm/org-keys";
import { CrmError, requireCrm } from "@/server/crm/access";
import { loadOrgKeys, removeOrgKey, saveOrgKey, testOrgKey, type OrgKeyResult, type OrgKeysView } from "@/server/crm/org-keys";
import { setAiCap } from "@/server/crm/usage";
import { SpaceRefusedError, withOrgAction } from "@/server/db/context";
import { resolveActor, type OrgActor } from "@/server/integrations/service";

/**
 * The organization's own keys (CRM settings > Connections; src/server/crm/org-keys.ts):
 * save, test and remove each provider's key, and set the monthly spending
 * cap. Not withOrgAction for the keys: saving and testing a secret run on
 * the service path with no transaction open around the network check; the
 * caller's role is resolved by the database first, then the operation
 * checks the permission (owners and admins; only owners remove).
 *
 * Every answer carries the refreshed view, so the card updates in place.
 * Keys are write-only and never come back.
 */

export type OrgKeysActionResult = (OrgKeyResult & { view?: OrgKeysView }) | { ok: false; error: string; view?: OrgKeysView };

const orgIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const keyIdSchema = z.enum(ORG_KEY_IDS);
const valuesSchema = z.record(z.string().max(40), z.string().max(600)).refine((v) => Object.keys(v).length <= 10);

async function withActor(orgId: string, fn: (actor: OrgActor, orgId: string) => Promise<OrgKeyResult>): Promise<OrgKeysActionResult> {
  let actor: OrgActor;
  let id: string;
  try {
    id = orgIdSchema.parse(orgId);
    actor = await resolveActor(id);
  } catch (error) {
    return failure(error);
  }
  let result: OrgKeyResult;
  try {
    result = await fn(actor, id);
  } catch (error) {
    result = failure(error);
  }
  try {
    return { ...result, view: await loadOrgKeys(id, actor) };
  } catch {
    return result;
  }
}

function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof ForbiddenError) return { ok: false, error: "Only owners and admins manage the organization's keys." };
  if (error instanceof NotFoundError) return { ok: false, error: "Not found." };
  if (error instanceof z.ZodError) return { ok: false, error: "Check what you typed." };
  if (error instanceof CrmError || error instanceof SpaceRefusedError) return { ok: false, error: error.message };
  console.error("[crm] org key action failed", error instanceof Error ? error.message : error);
  return { ok: false, error: "That didn't work. Try again." };
}

/** Every key's state, this month's use and the cap (owners and admins). */
export async function loadOrgKeysAction(orgId: string): Promise<{ ok: true; view: OrgKeysView } | { ok: false; error: string }> {
  try {
    const id = orgIdSchema.parse(orgId);
    return { ok: true, view: await loadOrgKeys(id, await resolveActor(id)) };
  } catch (error) {
    return failure(error);
  }
}

/** Saves (or replaces) a provider's key and tests it at once. */
export async function saveOrgKeyAction(orgId: string, provider: string, values: Record<string, string>): Promise<OrgKeysActionResult> {
  return withActor(orgId, (actor, id) => saveOrgKey(id, actor, keyIdSchema.parse(provider), valuesSchema.parse(values)));
}

/** Tests a saved key with one free call at the provider. */
export async function testOrgKeyAction(orgId: string, provider: string): Promise<OrgKeysActionResult> {
  return withActor(orgId, (actor, id) => testOrgKey(id, actor, keyIdSchema.parse(provider)));
}

/** Deletes a provider's key (owners). */
export async function removeOrgKeyAction(orgId: string, provider: string): Promise<OrgKeysActionResult> {
  return withActor(orgId, (actor, id) => removeOrgKey(id, actor, keyIdSchema.parse(provider)));
}

const setCap = withOrgAction(
  async (ctx, dollars: number | null) => {
    const access = await requireCrm(ctx);
    return setAiCap({ ...ctx, admin: access.admin }, dollars);
  },
  { feature: "crm" },
);

/** The monthly spending cap across every key, in dollars (null: no cap). Owners and admins. */
export async function setSpendCapAction(orgId: string, dollars: number | null): Promise<OrgKeysActionResult> {
  return withActor(orgId, async (_actor, id) => {
    const value = dollars === null ? null : z.number().finite().parse(dollars);
    const cents = await setCap(id, value);
    return { ok: true, message: cents === null ? "No monthly cap." : "Monthly cap saved." };
  });
}
