import type { TxClient } from "@/server/db/context";

import { CrmError, type CrmActor } from "./access";
import { featureLabel } from "./ai";

/**
 * This month's AI use, for CRM settings (docs/features/crm.md: "the org's
 * key with a hard monthly cap; usage shown live"): by feature and by
 * member, with the cap. Read as an owner or admin, whom RLS lets see every
 * AiUsage row (members see only their own).
 */

export interface UsageLine {
  key: string;
  label: string;
  calls: number;
  costMicros: number;
}

export interface UsageSummary {
  monthStart: string;
  totalMicros: number;
  /** Spend on Bananasplit's key (Bananasplit AI, later); not counted against the cap. */
  platformMicros: number;
  calls: number;
  lookups: number;
  byFeature: UsageLine[];
  byMember: UsageLine[];
  capCents: number | null;
}

function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

// Everything metered per use that isn't a model call (src/server/crm/spend.ts).
const LOOKUP_PROVIDERS = new Set(["tavily", "hunter", "prospeo", "telnyx", "twilio", "deepgram", "resend"]);

export async function usageThisMonth(db: TxClient, organizationId: string): Promise<UsageSummary> {
  const since = monthStart();
  const rows = await db.aiUsage.groupBy({
    by: ["feature", "userId", "paidBy", "provider"],
    where: { organizationId, createdAt: { gte: since }, feature: { not: "crm.reserve" } },
    _count: { _all: true },
    _sum: { costMicros: true },
  });
  const settings = await db.crmSettings.findUnique({ where: { organizationId }, select: { aiMonthlyCapCents: true } });
  const userIds = [...new Set(rows.map((r) => r.userId).filter((x): x is string => Boolean(x)))];
  const users = userIds.length
    ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : [];
  const names = new Map(users.map((u) => [u.id, u.name ?? "A member"]));
  const feature = new Map<string, UsageLine>();
  const member = new Map<string, UsageLine>();
  let total = 0;
  let platform = 0;
  let calls = 0;
  let lookups = 0;
  for (const r of rows) {
    const cost = r._sum.costMicros ?? 0;
    const n = r._count._all;
    if (LOOKUP_PROVIDERS.has(r.provider)) lookups += n;
    else calls += n;
    if (r.paidBy === "PLATFORM") platform += cost;
    else total += cost;
    const f = feature.get(r.feature) ?? { key: r.feature, label: featureLabel(r.feature), calls: 0, costMicros: 0 };
    f.calls += n;
    f.costMicros += cost;
    feature.set(r.feature, f);
    const mk = r.userId ?? "jobs";
    const m = member.get(mk) ?? { key: mk, label: r.userId ? (names.get(r.userId) ?? "A former member") : "Background jobs", calls: 0, costMicros: 0 };
    m.calls += n;
    m.costMicros += cost;
    member.set(mk, m);
  }
  const sort = (a: UsageLine, b: UsageLine) => b.costMicros - a.costMicros || b.calls - a.calls;
  return {
    monthStart: since.toISOString(),
    totalMicros: total,
    platformMicros: platform,
    calls,
    lookups,
    byFeature: [...feature.values()].sort(sort),
    byMember: [...member.values()].sort(sort),
    capCents: settings?.aiMonthlyCapCents ?? null,
  };
}

/** Owners and admins set the hard monthly cap (null: no cap). */
export async function setAiCap(actor: CrmActor & { admin: boolean }, capDollars: number | null): Promise<number | null> {
  if (!actor.admin) throw new CrmError("Only owners and admins can set the monthly spending cap.");
  let cents: number | null = null;
  if (capDollars !== null) {
    if (!Number.isFinite(capDollars) || capDollars < 0 || capDollars > 100_000) throw new CrmError("Enter a monthly cap between $0 and $100,000.");
    cents = Math.round(capDollars * 100);
  }
  await actor.db.crmSettings.update({ where: { organizationId: actor.organizationId }, data: { aiMonthlyCapCents: cents } });
  return cents;
}

/** Managers set the enrichment waterfall's order. */
export async function setEnrichmentOrder(actor: CrmActor, order: readonly string[]): Promise<string[]> {
  const allowed = ["hunter", "prospeo", "tavily", "claude"];
  const clean = [...new Set(order.filter((s) => allowed.includes(s)))];
  await actor.db.crmSettings.update({ where: { organizationId: actor.organizationId }, data: { enrichmentOrder: clean } });
  return clean;
}

export { formatMicros } from "@/lib/crm/ai-outputs";
