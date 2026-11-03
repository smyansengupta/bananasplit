import {
  companyBlocks,
  findPairs,
  personBlocks,
  scoreCompanies,
  scorePeople,
  type DedupeCompany,
  type DedupePerson,
} from "@/lib/crm/dedupe";
import type { TxClient } from "@/server/db/context";

import { CrmError, requireCrm, type CrmActor } from "./access";
import { mergeCompanies, mergePeople, type MergeResult } from "./merge";

/**
 * Finding duplicates (src/lib/crm/dedupe.ts scores them): a scan of the
 * organization's people and companies that writes each likely pair as a
 * MERGE suggestion (source DEDUPE) for the review list. A pair once
 * rejected is never suggested again. Runs as a job after imports and
 * nightly, and on "Look for duplicates".
 */

/** Most records a scan reads (the newest); bigger organizations are scanned by the job in turns. */
const SCAN_LIMIT = 20_000;
/** Most new suggestions one scan writes. */
const MAX_NEW = 500;

export interface MergePayload {
  object: "person" | "company";
  ids: [string, string];
  score: number;
  reasons: string[];
}

function pairKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

async function knownPairs(db: TxClient, organizationId: string): Promise<Set<string>> {
  const rows = await db.crmSuggestion.findMany({
    where: { organizationId, kind: "MERGE" },
    select: { payload: true },
    orderBy: { createdAt: "desc" },
    take: 20_000,
  });
  const out = new Set<string>();
  for (const r of rows) {
    const ids = (r.payload as { ids?: string[] } | null)?.ids;
    if (ids?.length === 2) out.add(`${ids[0]}|${ids[1]}`);
  }
  return out;
}

export async function scanDuplicates(
  db: TxClient,
  organizationId: string,
  proposedById: string | null,
): Promise<{ people: number; companies: number }> {
  const known = await knownPairs(db, organizationId);
  const people = await db.crmPerson.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: SCAN_LIMIT,
    select: { id: true, name: true, phone: true, companyId: true, emails: { select: { email: true } } },
  });
  const personRecords: DedupePerson[] = people.map((p) => ({
    id: p.id,
    name: p.name,
    phone: p.phone,
    companyId: p.companyId,
    emails: p.emails.map((e) => e.email),
  }));
  const companies = await db.crmCompany.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: SCAN_LIMIT,
    select: { id: true, name: true, domain: true, website: true },
  });
  const companyRecords: DedupeCompany[] = companies;

  let written = 0;
  const write = async (object: "person" | "company", a: { id: string; name: string }, b: { id: string; name: string }, score: number, reasons: string[]) => {
    const ids = pairKey(a.id, b.id);
    if (known.has(`${ids[0]}|${ids[1]}`) || written >= MAX_NEW) return false;
    known.add(`${ids[0]}|${ids[1]}`);
    const payload: MergePayload = { object, ids, score, reasons };
    await db.crmSuggestion.create({
      data: {
        organizationId,
        kind: "MERGE",
        source: "DEDUPE",
        title:
          object === "person"
            ? `${a.name} and ${b.name} look like the same person`
            : `${a.name} and ${b.name} look like the same company`,
        summary: reasons.join(". "),
        payload: payload as unknown as object,
        targetKind: object,
        targetId: ids[0],
        proposedById,
      },
    });
    written++;
    return true;
  };

  let peopleCount = 0;
  for (const pair of findPairs(personRecords, personBlocks, scorePeople)) {
    if (await write("person", pair.a, pair.b, pair.score, pair.reasons)) peopleCount++;
  }
  let companyCount = 0;
  for (const pair of findPairs(companyRecords, companyBlocks, scoreCompanies)) {
    if (await write("company", pair.a, pair.b, pair.score, pair.reasons)) companyCount++;
  }
  return { people: peopleCount, companies: companyCount };
}

export interface DuplicateSuggestion {
  id: string;
  object: "person" | "company";
  title: string;
  score: number;
  reasons: string[];
  records: {
    id: string;
    name: string;
    sub: string | null;
    createdAt: Date;
  }[];
  createdAt: Date;
}

/** The review list: pending pairs whose records are both still here. */
export async function pendingDuplicates(
  db: TxClient,
  organizationId: string,
  take = 100,
): Promise<DuplicateSuggestion[]> {
  const rows = await db.crmSuggestion.findMany({
    where: { organizationId, kind: "MERGE", status: "PENDING" },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, title: true, payload: true, createdAt: true },
  });
  const out: DuplicateSuggestion[] = [];
  for (const r of rows) {
    const p = r.payload as unknown as MergePayload;
    if (!p?.ids || p.ids.length !== 2) continue;
    const records =
      p.object === "person"
        ? (
            await db.crmPerson.findMany({
              where: { organizationId, id: { in: p.ids }, deletedAt: null },
              select: { id: true, name: true, primaryEmail: true, title: true, createdAt: true },
            })
          ).map((x) => ({ id: x.id, name: x.name, sub: x.primaryEmail ?? x.title, createdAt: x.createdAt }))
        : (
            await db.crmCompany.findMany({
              where: { organizationId, id: { in: p.ids }, deletedAt: null },
              select: { id: true, name: true, domain: true, createdAt: true },
            })
          ).map((x) => ({ id: x.id, name: x.name, sub: x.domain, createdAt: x.createdAt }));
    if (records.length !== 2) continue;
    out.push({
      id: r.id,
      object: p.object,
      title: r.title,
      score: p.score,
      reasons: p.reasons ?? [],
      records,
      createdAt: r.createdAt,
    });
  }
  return out;
}

/** Accept (merge, keeping `keepId`) or reject a duplicate suggestion. */
export async function resolveDuplicate(
  actor: CrmActor,
  suggestionId: string,
  decision: { accept: false } | { accept: true; keepId: string },
): Promise<MergeResult | null> {
  await requireCrm(actor);
  const { db, organizationId, userId } = actor;
  const s = await db.crmSuggestion.findFirst({
    where: { id: suggestionId, organizationId, kind: "MERGE", status: "PENDING" },
    select: { id: true, payload: true },
  });
  if (!s) throw new CrmError("That suggestion was already handled.");
  const p = s.payload as unknown as MergePayload;
  if (!decision.accept) {
    await db.crmSuggestion.update({
      where: { id: s.id },
      data: { status: "REJECTED", reviewedById: userId, reviewedAt: new Date() },
    });
    return null;
  }
  if (!p.ids.includes(decision.keepId)) throw new CrmError("Pick one of the two to keep.");
  const dropId = p.ids.find((x) => x !== decision.keepId)!;
  const result =
    p.object === "person"
      ? await mergePeople(actor, decision.keepId, dropId, { trusted: true })
      : await mergeCompanies(actor, decision.keepId, dropId, { trusted: true });
  await db.crmSuggestion.updateMany({
    where: { id: s.id, organizationId, status: "PENDING" },
    data: { status: "ACCEPTED", reviewedById: userId, reviewedAt: new Date() },
  });
  return result;
}
