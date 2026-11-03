import type { z } from "zod";

import type { TxClient } from "@/server/db/context";
import type { AiCredentials } from "@/server/ai/connections";
import { AiImportError, generateStructured, type StructuredRequest, type StructuredResult } from "@/server/ai/generate";

/**
 * Every CRM AI call goes through here (docs/features/crm.md module 10): it
 * checks the organization's hard monthly cap (CrmSettings.aiMonthlyCapCents)
 * before calling, and writes an AiUsage row after, whoever paid. Later,
 * Bananasplit AI is one more provider behind the same call, so features
 * never change when it arrives.
 *
 * The model call itself must run outside a transaction (assertNoTx in
 * generateStructured), so callers do: `await checkAiCap(db, ...)` in a
 * transaction, `crmGenerate(...)` outside it, then `recordAiUsage(db, ...)`
 * in a transaction with the result.
 */

/** Rough list prices per million tokens in micro-dollars (input, output), for the cap and the meter. */
const PRICES: { match: RegExp; input: number; output: number }[] = [
  { match: /haiku/i, input: 100_000, output: 500_000 },
  { match: /sonnet/i, input: 3_000_000, output: 15_000_000 },
  { match: /opus/i, input: 5_000_000, output: 25_000_000 },
];
const FALLBACK = { input: 1_000_000, output: 5_000_000 };

export function estimateCostMicros(model: string | null | undefined, input: number, output: number): number {
  const p = PRICES.find((x) => model && x.match.test(model)) ?? FALLBACK;
  return Math.round((input * p.input + output * p.output) / 1_000_000);
}

function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** This month's AI spend on the org's own key, in micro-dollars. */
export async function aiSpendThisMonth(db: TxClient, organizationId: string): Promise<number> {
  const agg = await db.aiUsage.aggregate({
    where: { organizationId, paidBy: "ORG_KEY", createdAt: { gte: monthStart() } },
    _sum: { costMicros: true },
  });
  return agg._sum.costMicros ?? 0;
}

/** Throws when the organization has reached its monthly AI cap. */
export async function checkAiCap(db: TxClient, organizationId: string): Promise<void> {
  const settings = await db.crmSettings.findUnique({
    where: { organizationId },
    select: { aiMonthlyCapCents: true },
  });
  const cap = settings?.aiMonthlyCapCents;
  if (cap == null) return;
  const spent = await aiSpendThisMonth(db, organizationId);
  if (spent >= cap * 10_000) {
    throw new AiImportError(
      "Your organization has used this month's AI budget. An owner or admin can raise it in CRM settings.",
      429,
    );
  }
}

/** One schema-bound answer. Outside a transaction; record it with recordAiUsage. */
export async function crmGenerate<S extends z.ZodObject>(
  creds: AiCredentials,
  req: StructuredRequest<S>,
): Promise<StructuredResult<z.infer<S>>> {
  return generateStructured(creds, req);
}

export async function recordAiUsage(
  db: TxClient,
  input: {
    organizationId: string;
    userId: string | null;
    feature: string;
    provider: string;
    result: Pick<StructuredResult<unknown>, "usage" | "model">;
    paidBy?: "ORG_KEY" | "PLATFORM";
  },
): Promise<void> {
  const inputTokens = input.result.usage?.input ?? 0;
  const outputTokens = input.result.usage?.output ?? 0;
  await db.aiUsage.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      feature: input.feature,
      provider: input.provider,
      model: input.result.model,
      inputTokens,
      outputTokens,
      costMicros: estimateCostMicros(input.result.model, inputTokens, outputTokens),
      paidBy: input.paidBy ?? "ORG_KEY",
    },
  });
}
