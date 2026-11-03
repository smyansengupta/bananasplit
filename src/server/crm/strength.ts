import { strengthOf, type Touchpoint } from "@/lib/crm/strength";
import type { TxClient } from "@/server/db/context";

/**
 * Recomputes CrmPerson.strength and CrmCompany.strength from every
 * touchpoint on their timelines (src/lib/crm/strength.ts scores them). A
 * company counts its own touchpoints and its people's. Only rows whose
 * score moved are written. Part of the crm-refresh job.
 */

const HORIZON_DAYS = 3 * 365;

interface Row {
  targetKind: string;
  targetId: string;
  kind: string;
  occurredAt: Date;
  actorId: string | null;
}

export async function recomputeStrength(
  db: TxClient,
  organizationId: string,
  now: Date = new Date(),
): Promise<{ people: number; companies: number }> {
  const since = new Date(now.getTime() - HORIZON_DAYS * 86_400_000);
  const rows = await db.$queryRaw<Row[]>`
    SELECT t."targetKind", t."targetId", a."kind"::text AS kind, a."occurredAt", a."actorId"
      FROM "CrmActivityTarget" t
      JOIN "CrmActivity" a ON a."id" = t."activityId" AND a."organizationId" = t."organizationId"
     WHERE t."organizationId" = ${organizationId}
       AND t."targetKind" IN ('person', 'company')
       AND a."deletedAt" IS NULL
       AND t."occurredAt" >= ${since}`;
  const byPerson = new Map<string, Touchpoint[]>();
  const byCompany = new Map<string, Touchpoint[]>();
  for (const r of rows) {
    const t: Touchpoint = { kind: r.kind, at: r.occurredAt, actorId: r.actorId };
    const map = r.targetKind === "person" ? byPerson : byCompany;
    const list = map.get(r.targetId);
    if (list) list.push(t);
    else map.set(r.targetId, [t]);
  }
  const people = await db.crmPerson.findMany({
    where: { organizationId, deletedAt: null },
    select: { id: true, strength: true, companyId: true },
    take: 100_000,
  });
  // A company's people's touchpoints count for it too (once per activity
  // is close enough: a meeting with three of them is a big meeting).
  for (const p of people) {
    if (!p.companyId) continue;
    const mine = byPerson.get(p.id);
    if (!mine) continue;
    const list = byCompany.get(p.companyId);
    if (list) list.push(...mine);
    else byCompany.set(p.companyId, [...mine]);
  }
  const changes = new Map<number, string[]>();
  for (const p of people) {
    const s = strengthOf(byPerson.get(p.id) ?? [], now);
    if (s === p.strength) continue;
    const ids = changes.get(s);
    if (ids) ids.push(p.id);
    else changes.set(s, [p.id]);
  }
  let peopleChanged = 0;
  for (const [strength, ids] of changes) {
    peopleChanged += (
      await db.crmPerson.updateMany({ where: { organizationId, id: { in: ids } }, data: { strength } })
    ).count;
  }
  const companies = await db.crmCompany.findMany({
    where: { organizationId, deletedAt: null },
    select: { id: true, strength: true },
    take: 100_000,
  });
  const companyChanges = new Map<number, string[]>();
  for (const c of companies) {
    const s = strengthOf(byCompany.get(c.id) ?? [], now);
    if (s === c.strength) continue;
    const ids = companyChanges.get(s);
    if (ids) ids.push(c.id);
    else companyChanges.set(s, [c.id]);
  }
  let companiesChanged = 0;
  for (const [strength, ids] of companyChanges) {
    companiesChanged += (
      await db.crmCompany.updateMany({ where: { organizationId, id: { in: ids } }, data: { strength } })
    ).count;
  }
  return { people: peopleChanged, companies: companiesChanged };
}

/** One record's touchpoints, for "who knows them best" on its page. */
export async function touchpointsOf(
  db: TxClient,
  organizationId: string,
  targetKind: "person" | "company",
  targetId: string,
): Promise<Touchpoint[]> {
  const rows = await db.$queryRaw<{ kind: string; occurredAt: Date; actorId: string | null }[]>`
    SELECT a."kind"::text AS kind, a."occurredAt", a."actorId"
      FROM "CrmActivityTarget" t
      JOIN "CrmActivity" a ON a."id" = t."activityId" AND a."organizationId" = t."organizationId"
     WHERE t."organizationId" = ${organizationId} AND t."targetKind" = ${targetKind}
       AND t."targetId" = ${targetId} AND a."deletedAt" IS NULL
     ORDER BY a."occurredAt" DESC LIMIT 2000`;
  return rows.map((r) => ({ kind: r.kind, at: r.occurredAt, actorId: r.actorId }));
}
