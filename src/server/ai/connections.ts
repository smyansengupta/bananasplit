import type { AiConnectionInfo } from "@/lib/ai/types";
import { aiVendor } from "@/lib/ai/vendors";
import { claudeModelLabel, DEFAULT_CLAUDE_MODEL } from "@/lib/org-chart/models";
import { assertNoTx, withSystemOrgTx } from "@/server/db/context";
import { getSecret } from "@/server/secrets";

/**
 * Which AI model the imports use: whichever the club has connected.
 *
 * - "claude": the club's own Claude key and model (Settings > Integrations
 *   > Claude API).
 * - "ai-model": the club's OpenAI-compatible key, vendor and model
 *   (Settings > Integrations > Other AI models). Fixed vendor addresses only.
 * - "platform": the platform's Claude key (ANTHROPIC_API_KEY, the one profile
 *   setup reads schedules with), when the server has one. Last in line.
 * - "standin": a local stand-in that reads lines without any AI, for trying
 *   the flow on a laptop. Only with AI_STANDIN=1 and never on Vercel.
 *
 * listAiConnections() says what is available (labels only, no keys) to any
 * member; resolveAiCredentials() decrypts the chosen key for the one request
 * that uses it, outside any transaction, and it is never logged or returned.
 * Reading the integration rows takes the service path because members can't
 * read OrgIntegration (owners and admins manage it); only labels leave here.
 */

export type { AiConnectionId, AiConnectionInfo } from "@/lib/ai/types";

export type AiCredentials =
  | { id: "claude" | "platform"; protocol: "anthropic"; apiKey: string; model: string; label: string }
  | {
      id: "ai-model";
      protocol: "openai";
      apiKey: string;
      model: string;
      label: string;
      vendorId: string;
      baseUrl: string;
      maxTokensParam: "max_tokens" | "max_completion_tokens";
    }
  | { id: "standin"; protocol: "standin"; model: string; label: string };

type Env = Record<string, string | undefined>;

const CLAUDE_MODEL = /^claude-[a-z0-9.-]{1,60}$/;

/** The platform key's model: AI_IMPORT_MODEL, else the schedule reader's, else Sonnet 5. */
export function platformModel(env: Env = process.env): string {
  for (const v of [env.AI_IMPORT_MODEL, env.SCHEDULE_IMPORT_MODEL]) {
    const m = v?.trim();
    if (m && CLAUDE_MODEL.test(m)) return m;
  }
  return "claude-sonnet-5";
}

export function platformKey(env: Env = process.env): string | null {
  return env.ANTHROPIC_API_KEY?.trim() || null;
}

/** The stand-in: opt-in, and never on a Vercel deployment. */
export function standinEnabled(env: Env = process.env): boolean {
  return env.AI_STANDIN?.trim() === "1" && !env.VERCEL;
}

interface IntegrationRow {
  provider: "CLAUDE" | "OPENAI_COMPATIBLE";
  status: string;
  secretFingerprint: string | null;
  config: unknown;
}

async function loadRows(orgId: string): Promise<IntegrationRow[]> {
  return withSystemOrgTx(orgId, async ({ db }) =>
    (await db.orgIntegration.findMany({
      where: { organizationId: orgId, provider: { in: ["CLAUDE", "OPENAI_COMPATIBLE"] } },
      select: { provider: true, status: true, secretFingerprint: true, config: true },
    })) as IntegrationRow[],
  );
}

function configOf(row: IntegrationRow | undefined): Record<string, unknown> {
  return row?.config && typeof row.config === "object" ? (row.config as Record<string, unknown>) : {};
}

function usable(row: IntegrationRow | undefined): row is IntegrationRow {
  return Boolean(row && row.secretFingerprint && row.status !== "DISCONNECTED");
}

function claudeModelOf(row: IntegrationRow): string {
  const m = configOf(row).model;
  return typeof m === "string" && CLAUDE_MODEL.test(m) ? m : DEFAULT_CLAUDE_MODEL;
}

function aiModelOf(row: IntegrationRow): { vendorId: string; model: string } | null {
  const c = configOf(row);
  const vendor = aiVendor(typeof c.vendor === "string" ? c.vendor : null);
  const model = typeof c.model === "string" ? c.model.trim() : "";
  return vendor && model ? { vendorId: vendor.id, model } : null;
}

/** What this club can use, best first. Labels only: no key leaves here. */
export async function listAiConnections(orgId: string, env: Env = process.env): Promise<AiConnectionInfo[]> {
  assertNoTx("listAiConnections");
  const rows = await loadRows(orgId);
  const claude = rows.find((r) => r.provider === "CLAUDE");
  const other = rows.find((r) => r.provider === "OPENAI_COMPATIBLE");
  const out: AiConnectionInfo[] = [];
  if (usable(claude)) {
    out.push({
      id: "claude",
      label: claudeModelLabel(claudeModelOf(claude)),
      detail: "Your club's Claude key",
      sentTo: "Anthropic (your club's account)",
    });
  }
  if (usable(other)) {
    const picked = aiModelOf(other);
    const vendor = aiVendor(picked?.vendorId);
    if (picked && vendor) {
      out.push({
        id: "ai-model",
        label: `${vendor.label.replace(/ \(.*\)$/, "")} · ${picked.model}`,
        detail: `Your club's ${vendor.label.replace(/ \(.*\)$/, "")} key`,
        sentTo: `${vendor.label.replace(/ \(.*\)$/, "")} (your club's account)`,
      });
    }
  }
  if (platformKey(env)) {
    out.push({
      id: "platform",
      label: claudeModelLabel(platformModel(env)),
      detail: "Bananasplit's Claude key",
      sentTo: "Anthropic (Bananasplit's account)",
    });
  }
  if (standinEnabled(env)) {
    out.push({
      id: "standin",
      label: "Local stand-in",
      detail: "Development only: splits lines, no AI",
      sentTo: "nowhere (it runs on this server)",
    });
  }
  return out;
}

/**
 * The credentials for `choice` (or the best available when it is missing or
 * not available), decrypted for this one request. Null when the club has
 * nothing connected.
 */
export async function resolveAiCredentials(
  orgId: string,
  choice: string | null | undefined,
  env: Env = process.env,
): Promise<AiCredentials | null> {
  assertNoTx("resolveAiCredentials");
  const available = await listAiConnections(orgId, env);
  const picked = available.find((c) => c.id === choice) ?? available[0];
  if (!picked) return null;
  switch (picked.id) {
    case "claude": {
      const apiKey = await getSecret({ orgId, provider: "CLAUDE", kind: "API_KEY" });
      if (!apiKey) return null;
      const row = (await loadRows(orgId)).find((r) => r.provider === "CLAUDE")!;
      return { id: "claude", protocol: "anthropic", apiKey, model: claudeModelOf(row), label: picked.label };
    }
    case "ai-model": {
      const apiKey = await getSecret({ orgId, provider: "OPENAI_COMPATIBLE", kind: "API_KEY" });
      const row = (await loadRows(orgId)).find((r) => r.provider === "OPENAI_COMPATIBLE");
      const target = row ? aiModelOf(row) : null;
      const vendor = aiVendor(target?.vendorId);
      if (!apiKey || !target || !vendor) return null;
      return {
        id: "ai-model",
        protocol: "openai",
        apiKey,
        model: target.model,
        label: picked.label,
        vendorId: vendor.id,
        baseUrl: vendor.baseUrl,
        maxTokensParam: vendor.maxTokensParam,
      };
    }
    case "platform": {
      const apiKey = platformKey(env);
      return apiKey
        ? { id: "platform", protocol: "anthropic", apiKey, model: platformModel(env), label: picked.label }
        : null;
    }
    case "standin":
      return { id: "standin", protocol: "standin", model: "stand-in", label: picked.label };
  }
}
