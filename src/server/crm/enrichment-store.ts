import type { Prisma } from "@/generated/prisma/client";
import type { Citation, TargetRef } from "@/lib/crm/suggestions";
import type { TxClient } from "@/server/db/context";

/**
 * Where a value came from (docs/features/crm.md module 4: "Each value
 * records where it came from and when"): CrmPerson.enrichment and
 * CrmCompany.enrichment hold `{ [field]: EnrichmentEntry }`, plus the
 * record's AI summary under `_summary`. Pipeline items have no enrichment
 * column, so theirs is a CrmView row of objectKind "deal-enrichment" named
 * by the item's id (one per writer, merged on read: RLS lets members update
 * only their own CrmView rows).
 */

export interface EnrichmentEntry {
  /** ai | connector | tavily | hunter | prospeo | claude-web | user ... */
  source: string;
  at: string;
  label?: string | null;
  url?: string | null;
  model?: string | null;
  /** The pages or records an AI value was drawn from. */
  citations?: { label: string; url?: string | null }[];
}

export interface StoredSummary {
  text: string;
  points: string[];
  at: string;
  model: string | null;
  by: string | null;
}

export type Enrichment = Record<string, EnrichmentEntry | StoredSummary | undefined> & { _summary?: StoredSummary };

function objectOf(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

export async function readEnrichment(db: TxClient, organizationId: string, target: TargetRef): Promise<Enrichment> {
  if (target.kind === "person") {
    const row = await db.crmPerson.findFirst({ where: { id: target.id, organizationId }, select: { enrichment: true } });
    return objectOf(row?.enrichment) as Enrichment;
  }
  if (target.kind === "company") {
    const row = await db.crmCompany.findFirst({ where: { id: target.id, organizationId }, select: { enrichment: true } });
    return objectOf(row?.enrichment) as Enrichment;
  }
  const rows = await db.crmView.findMany({
    where: { organizationId, objectKind: "deal-enrichment", name: target.id },
    orderBy: { updatedAt: "asc" },
    select: { filters: true },
  });
  return Object.assign({}, ...rows.map((r) => objectOf(r.filters))) as Enrichment;
}

/** Merges `patch` into the record's enrichment (keys set to undefined are dropped). */
export async function patchEnrichment(
  db: TxClient,
  organizationId: string,
  target: TargetRef,
  patch: Record<string, unknown>,
  writerId: string | null,
): Promise<void> {
  const current = await readEnrichment(db, organizationId, target);
  const next = { ...current, ...patch } as Record<string, unknown>;
  for (const [k, v] of Object.entries(next)) if (v === undefined) delete next[k];
  const json = next as Prisma.InputJsonObject;
  if (target.kind === "person") {
    await db.crmPerson.updateMany({ where: { id: target.id, organizationId }, data: { enrichment: json } });
    return;
  }
  if (target.kind === "company") {
    await db.crmCompany.updateMany({ where: { id: target.id, organizationId }, data: { enrichment: json } });
    return;
  }
  const updated = await db.crmView.updateMany({
    where: {
      organizationId,
      objectKind: "deal-enrichment",
      name: target.id,
      ...(writerId ? { createdById: writerId } : {}),
    },
    data: { filters: json },
  });
  if (updated.count === 0) {
    await db.crmView.create({
      data: {
        organizationId,
        objectKind: "deal-enrichment",
        name: target.id,
        filters: json,
        layout: "enrichment",
        shared: true,
        createdById: writerId,
      },
    });
  }
}

/** Records the source of each of `fields` on the record, from a citation. */
export async function recordEnrichment(
  db: TxClient,
  organizationId: string,
  target: TargetRef,
  fields: readonly string[],
  source: string,
  citation: Pick<Citation, "label" | "url">,
  writerId: string | null = null,
): Promise<void> {
  if (fields.length === 0) return;
  const at = new Date().toISOString();
  const entry: EnrichmentEntry = { source, at, label: citation.label, url: citation.url ?? null };
  await patchEnrichment(
    db,
    organizationId,
    target,
    Object.fromEntries(fields.map((f) => [f, entry])),
    writerId,
  );
}

export function summaryOf(enrichment: Enrichment): StoredSummary | null {
  const s = enrichment._summary;
  return s && typeof s === "object" && typeof s.text === "string" ? s : null;
}

/** Field entries only (no summary), for "where this came from" next to values. */
export function fieldSources(enrichment: Enrichment): Record<string, EnrichmentEntry> {
  const out: Record<string, EnrichmentEntry> = {};
  for (const [k, v] of Object.entries(enrichment)) {
    if (k.startsWith("_") || !v || typeof v !== "object" || !("source" in v)) continue;
    out[k] = v as EnrichmentEntry;
  }
  return out;
}
