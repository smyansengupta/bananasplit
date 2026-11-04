import type { IntegrationProvider } from "@/generated/prisma/client";
import { can, requirePermission } from "@/lib/auth/permissions";
import { spaceIncludes } from "@/lib/billing/space";
import {
  keyOfMeterProvider,
  maskKey,
  ORG_KEYS,
  orgKeyInfo,
  type OrgKeyId,
  type OrgKeysView,
  type OrgKeyState,
} from "@/lib/crm/org-keys";
import { withSystemOrgTx } from "@/server/db/context";
import { saveAiModel, saveClaude, saveEmailSender, testProvider, type OrgActor } from "@/server/integrations/service";
import { removeSecret } from "@/server/secrets";

import { saveDataKey, testDataKey } from "./data-connectors";
import { saveDeepgram, saveTelnyx, saveTwilio, testPhoneIntegration } from "./phone/connect";

/**
 * Each organization's own keys for everything the CRM pays per use
 * (docs/features/crm.md, "Whose keys pay for what"): one place to save,
 * test and remove them, and to read this month's use per key against the
 * monthly spending cap. A thin layer over the existing integration
 * operations, so every key still goes through src/server/secrets
 * (encrypted at rest with the org's envelope keys, audited, owners
 * alerted) and every network check runs with no transaction open.
 *
 * Owners and admins save and test (integrations.write); only owners remove
 * (integrations.remove, the secrets module's own rule). Nothing here ever
 * returns a key: only its last four characters, as a mask.
 */

export type { OrgKeysView, OrgKeyState } from "@/lib/crm/org-keys";

export type OrgKeyResult = { ok: true; message: string } | { ok: false; error: string };

export const PROVIDER_OF: Record<OrgKeyId, IntegrationProvider> = {
  anthropic: "CLAUDE",
  openai: "OPENAI_COMPATIBLE",
  tavily: "TAVILY",
  hunter: "HUNTER",
  prospeo: "PROSPEO",
  telnyx: "TELNYX",
  twilio: "TWILIO",
  deepgram: "DEEPGRAM",
  resend: "EMAIL_RESEND",
};

/** Non-secret settings shown back in the form (never a key). */
const SHOWN_CONFIG: Partial<Record<OrgKeyId, readonly string[]>> = {
  openai: ["vendor", "model"],
  telnyx: ["publicKey", "connectionId"],
  twilio: ["accountSid"],
  resend: ["fromName", "fromAddress"],
};

function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Every key's state for CRM settings (owners and admins), labels only, read on the service path. */
export async function loadOrgKeys(orgId: string, actor: OrgActor, now = new Date()): Promise<OrgKeysView> {
  requirePermission(actor, "integrations.view");
  const since = monthStart(now);
  const { rows, usage, settings, org } = await withSystemOrgTx(orgId, async ({ db }) => ({
    rows: await db.orgIntegration.findMany({
      where: { organizationId: orgId, provider: { in: Object.values(PROVIDER_OF) } },
      select: { provider: true, status: true, secretFingerprint: true, secretLast4: true, lastError: true, lastVerifiedAt: true, config: true },
    }),
    usage: await db.aiUsage.groupBy({
      by: ["provider"],
      where: { organizationId: orgId, paidBy: "ORG_KEY", createdAt: { gte: since }, feature: { not: "crm.reserve" } },
      _count: { _all: true },
      _sum: { costMicros: true },
    }),
    settings: await db.crmSettings.findUnique({ where: { organizationId: orgId }, select: { aiMonthlyCapCents: true } }),
    org: await db.organization.findUnique({
      where: { id: orgId },
      select: { kind: true, plan: true, trialEndsAt: true, planAfterTrial: true },
    }),
  }));
  const spent = new Map<OrgKeyId, { micros: number; uses: number }>();
  let total = 0;
  for (const u of usage) {
    const micros = u._sum.costMicros ?? 0;
    total += micros;
    const id = keyOfMeterProvider(u.provider);
    if (!id) continue;
    const s = spent.get(id) ?? { micros: 0, uses: 0 };
    s.micros += micros;
    s.uses += u._count._all;
    spent.set(id, s);
  }
  const keys = ORG_KEYS.map((info): OrgKeyState => {
    const row = rows.find((r) => r.provider === PROVIDER_OF[info.id]);
    const saved = Boolean(row?.secretFingerprint);
    const config = (row?.config ?? {}) as Record<string, unknown>;
    const values: Record<string, string> = {};
    for (const name of SHOWN_CONFIG[info.id] ?? []) {
      const v = str(config[name]);
      if (v) values[name] = v;
    }
    const status: OrgKeyState["status"] = !saved
      ? "none"
      : row?.status === "CONNECTED"
        ? "connected"
        : row?.status === "ERROR" || row?.status === "NEEDS_REAUTH"
          ? "attention"
          : "untested";
    return {
      id: info.id,
      group: info.group,
      label: info.label,
      masked: saved ? maskKey(info.prefix, row?.secretLast4) : null,
      status,
      lastError: saved ? (row?.lastError ?? null) : null,
      checkedAt: saved ? (row?.lastVerifiedAt?.toISOString() ?? null) : null,
      values,
      spentMicros: spent.get(info.id)?.micros ?? 0,
      uses: spent.get(info.id)?.uses ?? 0,
    };
  });
  return {
    keys,
    capCents: settings?.aiMonthlyCapCents ?? null,
    spentMicros: total,
    month: since.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
    canRemove: can(actor, "integrations.remove"),
    aiOnPlan: Boolean(org && spaceIncludes(org, "ai", now)),
  };
}

function words(r: { ok: true; message?: string } | { ok: false; error: string }, fallback: string): OrgKeyResult {
  return r.ok ? { ok: true, message: r.message ?? fallback } : { ok: false, error: r.error };
}

function field(values: Record<string, string | undefined>, name: string): string | undefined {
  const v = values[name];
  return typeof v === "string" ? v.slice(0, 600) : undefined;
}

/** Saves (or replaces) a key and tests it at once. Owners and admins. */
export async function saveOrgKey(
  orgId: string,
  actor: OrgActor,
  id: OrgKeyId,
  values: Record<string, string | undefined>,
): Promise<OrgKeyResult> {
  requirePermission(actor, "integrations.write");
  const info = orgKeyInfo(id);
  if (!info) return { ok: false, error: "Pick one of the listed providers." };
  const apiKey = field(values, "apiKey")?.trim() || undefined;
  switch (id) {
    case "anthropic":
      if (!apiKey) return { ok: false, error: "Paste the API key first." };
      return words(await saveClaude(orgId, actor, { apiKey }), "Saved. The key works.");
    case "openai":
      return words(
        await saveAiModel(orgId, actor, { apiKey, vendor: field(values, "vendor") ?? "openai", model: field(values, "model") }),
        "Saved. The key works.",
      );
    case "tavily":
    case "hunter":
    case "prospeo":
      if (!apiKey) return { ok: false, error: "Paste the API key first." };
      return words(await saveDataKey(orgId, actor, id, apiKey), "Saved. The key works.");
    case "telnyx":
      return words(
        await saveTelnyx(orgId, actor, { apiKey, publicKey: field(values, "publicKey"), connectionId: field(values, "connectionId") }),
        "Saved. Telnyx accepted the key.",
      );
    case "twilio":
      return words(
        await saveTwilio(orgId, actor, { accountSid: field(values, "accountSid"), authToken: field(values, "authToken") }),
        "Saved. Twilio accepted it.",
      );
    case "deepgram":
      return words(await saveDeepgram(orgId, actor, { apiKey }), "Saved. Deepgram accepted the key.");
    case "resend":
      return words(
        await saveEmailSender(orgId, actor, {
          fromName: field(values, "fromName") ?? "",
          fromAddress: field(values, "fromAddress") ?? "",
          apiKey,
        }),
        "Saved.",
      );
  }
}

/** Tests a saved key with one free call at the provider. Owners and admins. */
export async function testOrgKey(orgId: string, actor: OrgActor, id: OrgKeyId): Promise<OrgKeyResult> {
  requirePermission(actor, "integrations.write");
  switch (id) {
    case "tavily":
    case "hunter":
    case "prospeo":
      return words(await testDataKey(orgId, actor, id), "The key works.");
    case "telnyx":
    case "twilio":
    case "deepgram":
      return words(await testPhoneIntegration(orgId, actor, PROVIDER_OF[id] as "TELNYX" | "TWILIO" | "DEEPGRAM"), "The key works.");
    default:
      return words(await testProvider(orgId, actor, PROVIDER_OF[id]), "The key works.");
  }
}

/** Deletes a key (and its integration's other secrets). Owners only, like every integration secret. */
export async function removeOrgKey(orgId: string, actor: OrgActor, id: OrgKeyId): Promise<OrgKeyResult> {
  requirePermission(actor, "integrations.remove");
  const info = orgKeyInfo(id);
  if (!info) return { ok: false, error: "Pick one of the listed providers." };
  // None of these keys has a grant to hand back first (unlike Google or the
  // meeting apps), so deleting the secrets is the whole of it: audited, and
  // the owners are told.
  const removed = await removeSecret({ orgId, actor, provider: PROVIDER_OF[id] });
  return { ok: true, message: removed ? `Removed. The ${info.label} key was deleted.` : "Nothing was stored." };
}
