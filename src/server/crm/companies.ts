import type { CrmRecordStatus, Prisma } from "@/generated/prisma/client";
import type { TxClient } from "@/server/db/context";

import { CrmError, requireCrm, requireMember, type CrmActor } from "./access";
import { checkCustomValues, crmDatabaseIds, customFieldsFor, requiredKeys } from "./databases";
import { diffCustom, diffFields, writeHistory } from "./history";
import * as n from "./normalize";
import type { WriteOptions } from "./people";

/**
 * Companies (on screen "Company", never "organization"): the other side of
 * a relationship when it's a group. Same rules as people: RLS through the
 * caller's transaction, field history on every change, the trash instead
 * of deleting. The domain is what work email addresses match on.
 */

export interface CompanyInput {
  name?: string | null;
  domain?: string | null;
  website?: string | null;
  industry?: string | null;
  size?: string | null;
  phone?: string | null;
  address?: string | null;
  description?: string | null;
  status?: CrmRecordStatus;
  ownerId?: string | null;
  ownerRoleKey?: string | null;
  nextFollowUpAt?: Date | string | null;
  custom?: Record<string, unknown>;
  sponsorId?: string | null;
}

const COMPANY_SELECT = {
  id: true,
  name: true,
  domain: true,
  website: true,
  industry: true,
  size: true,
  phone: true,
  address: true,
  description: true,
  status: true,
  ownerId: true,
  ownerRoleKey: true,
  nextFollowUpAt: true,
  custom: true,
  deletedAt: true,
} satisfies Prisma.CrmCompanySelect;

type CompanyRow = Prisma.CrmCompanyGetPayload<{ select: typeof COMPANY_SELECT }>;

function historyFields(c: CompanyRow): Record<string, unknown> {
  const { custom: _c, deletedAt: _d, id: _i, ...rest } = c;
  return rest;
}

async function clean(actor: CrmActor, input: CompanyInput): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = {
    name: n.text(input.name, 200),
    domain: n.domain(input.domain),
    website: n.url(input.website),
    industry: n.text(input.industry, 120),
    size: n.text(input.size, 60),
    phone: n.phone(input.phone),
    address: n.text(input.address, 300),
    description: n.longText(input.description),
    status: input.status,
    ownerId: n.id(input.ownerId),
    ownerRoleKey: n.text(input.ownerRoleKey, 100),
    nextFollowUpAt: n.date(input.nextFollowUpAt, "Next follow-up"),
    sponsorId: n.id(input.sponsorId),
  };
  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];
  if (data.status !== undefined && !["ACTIVE", "INACTIVE", "ALUMNI"].includes(String(data.status))) {
    throw new CrmError("Pick Active, Inactive or Alumni.");
  }
  if (data.ownerId) await requireMember(actor.db, actor.organizationId, String(data.ownerId));
  // A website names the domain when none was given.
  if (data.domain === undefined && typeof data.website === "string") {
    const host = (() => {
      try {
        return new URL(String(data.website)).hostname.replace(/^www\./, "");
      } catch {
        return null;
      }
    })();
    if (host) data.domain = host.toLowerCase();
  }
  return data;
}

async function checkRequired(
  db: TxClient,
  organizationId: string,
  after: Record<string, unknown>,
  custom: Record<string, unknown>,
): Promise<void> {
  const ids = await crmDatabaseIds(db, organizationId);
  if (!ids.companies) return;
  const def = await db.databaseDefinition.findFirst({
    where: { id: ids.companies, organizationId },
    select: { columns: true },
  });
  const required = requiredKeys(def?.columns);
  const values: Record<string, unknown> = { ...after, owner: after.ownerId ?? after.ownerRoleKey, ...custom };
  const missing = required.filter((k) => values[k] === null || values[k] === undefined || values[k] === "");
  if (missing.length > 0) {
    const fields = await customFieldsFor(db, organizationId, "company");
    throw new CrmError(
      `Add ${missing.map((k) => fields.find((f) => f.id === k)?.name ?? k).join(", ")} first.`,
      missing,
    );
  }
}

/** The live company with this domain, if any (domains match work email). */
export async function companyByDomain(db: TxClient, organizationId: string, domain: string) {
  return db.crmCompany.findFirst({
    where: { organizationId, deletedAt: null, domain },
    select: { id: true, name: true },
  });
}

export async function createCompany(
  actor: CrmActor,
  input: CompanyInput,
  options: WriteOptions = {},
): Promise<{ id: string }> {
  if (!options.trusted) await requireCrm(actor);
  const { db, organizationId, userId } = actor;
  const data = await clean(actor, input);
  if (!data.name) throw new CrmError("Give the company a name.", ["name"]);
  if (data.domain) {
    const same = await companyByDomain(db, organizationId, String(data.domain));
    if (same) throw new CrmError(`${same.name} already has ${data.domain}.`, ["domain"]);
  }
  const fields = await customFieldsFor(db, organizationId, "company");
  const custom = input.custom ? await checkCustomValues(db, organizationId, fields, {}, input.custom) : {};
  await checkRequired(db, organizationId, data, custom);
  if (data.ownerId === undefined && data.ownerRoleKey === undefined) data.ownerId = userId;
  const created = await db.crmCompany.create({
    data: {
      ...(data as Prisma.CrmCompanyUncheckedCreateInput),
      name: String(data.name),
      organizationId,
      custom: custom as Prisma.InputJsonObject,
      createdById: userId,
      updatedById: userId,
    },
    select: { id: true },
  });
  // People already in the CRM with an address at this domain work here.
  if (data.domain) {
    const people = await db.crmPerson.findMany({
      where: {
        organizationId,
        deletedAt: null,
        companyId: null,
        emails: { some: { email: { endsWith: `@${String(data.domain)}` } } },
      },
      select: { id: true },
      take: 500,
    });
    if (people.length > 0) {
      await db.crmPerson.updateMany({
        where: { organizationId, id: { in: people.map((p) => p.id) } },
        data: { companyId: created.id },
      });
    }
  }
  await writeHistory(db, {
    organizationId,
    targetKind: "company",
    targetId: created.id,
    changes: [{ field: "created", oldValue: null, newValue: data.name }],
    userId,
    source: options.source,
    batchId: options.batchId,
  });
  return created;
}

export async function updateCompany(
  actor: CrmActor,
  companyId: string,
  input: CompanyInput,
  options: WriteOptions = {},
): Promise<{ changed: string[] }> {
  if (!options.trusted) await requireCrm(actor);
  const { db, organizationId, userId } = actor;
  const before = await db.crmCompany.findFirst({
    where: { id: companyId, organizationId },
    select: COMPANY_SELECT,
  });
  if (!before) throw new CrmError("That company isn't in the CRM any more.");
  if (before.deletedAt) throw new CrmError("It's in the trash. Restore it first.");
  const data = await clean(actor, input);
  if (data.name === null) throw new CrmError("Give the company a name.", ["name"]);
  if (data.domain && data.domain !== before.domain) {
    const same = await companyByDomain(db, organizationId, String(data.domain));
    if (same && same.id !== companyId) throw new CrmError(`${same.name} already has ${data.domain}.`, ["domain"]);
  }
  const fields = await customFieldsFor(db, organizationId, "company");
  const beforeCustom = (before.custom ?? {}) as Record<string, unknown>;
  const custom = input.custom
    ? await checkCustomValues(db, organizationId, fields, beforeCustom, input.custom)
    : beforeCustom;
  await checkRequired(db, organizationId, { ...historyFields(before), ...data }, custom);
  const changes = [...diffFields(historyFields(before), data), ...diffCustom(beforeCustom, custom)];
  if (changes.length === 0) return { changed: [] };
  await db.crmCompany.update({
    where: { id: companyId },
    data: {
      ...(data as Prisma.CrmCompanyUncheckedUpdateInput),
      custom: custom as Prisma.InputJsonObject,
      updatedById: userId,
    },
  });
  await writeHistory(db, {
    organizationId,
    targetKind: "company",
    targetId: companyId,
    changes,
    userId,
    source: options.source,
    batchId: options.batchId,
  });
  return { changed: changes.map((c) => c.field) };
}

export async function trashCompanies(actor: CrmActor, ids: readonly string[], batchId?: string): Promise<number> {
  await requireCrm(actor);
  const { db, organizationId, userId } = actor;
  const rows = await db.crmCompany.findMany({
    where: { organizationId, id: { in: [...ids] }, deletedAt: null },
    select: { id: true },
  });
  const now = new Date();
  for (const r of rows) {
    await db.crmCompany.update({ where: { id: r.id }, data: { deletedAt: now, updatedById: userId } });
    await writeHistory(db, {
      organizationId,
      targetKind: "company",
      targetId: r.id,
      changes: [{ field: "deletedAt", oldValue: null, newValue: now }],
      userId,
      batchId,
    });
  }
  return rows.length;
}

export async function restoreCompanies(actor: CrmActor, ids: readonly string[]): Promise<number> {
  await requireCrm(actor);
  const { db, organizationId, userId } = actor;
  const rows = await db.crmCompany.findMany({
    where: { organizationId, id: { in: [...ids] }, deletedAt: { not: null } },
    select: { id: true, deletedAt: true },
  });
  for (const r of rows) {
    await db.crmCompany.update({ where: { id: r.id }, data: { deletedAt: null, updatedById: userId } });
    await writeHistory(db, {
      organizationId,
      targetKind: "company",
      targetId: r.id,
      changes: [{ field: "deletedAt", oldValue: r.deletedAt, newValue: null }],
      userId,
    });
  }
  return rows.length;
}
