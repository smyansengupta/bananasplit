import type { CrmRecordStatus, Prisma } from "@/generated/prisma/client";
import { normalizeEmail, workDomain } from "@/lib/crm/dedupe";
import { personName, splitName } from "@/lib/crm/fields";
import type { TxClient } from "@/server/db/context";

import { CrmError, requireCrm, requireMember, type CrmActor } from "./access";
import { logActivity } from "./activity";
import { checkCustomValues, crmDatabaseIds, customFieldsFor, requiredKeys } from "./databases";
import { diffCustom, diffFields, writeHistory, type HistorySource } from "./history";
import * as n from "./normalize";

/**
 * People (docs/features/crm.md, CrmPerson): create, edit, trash and
 * restore, through the caller's transaction (withOrgAction / withOrgTx), so
 * RLS decides who may. Every change writes field history; every address is
 * a CrmPersonEmail row (lowercased, one person per address in the
 * organization); changing company closes the old job and opens a new one.
 */

export interface PersonInput {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  primaryEmail?: string | null;
  /** Other addresses (the primary is kept separately). */
  otherEmails?: readonly string[];
  phone?: string | null;
  title?: string | null;
  companyId?: string | null;
  /** A company by name: the existing one with that name, or a new one. */
  companyName?: string | null;
  linkedinUrl?: string | null;
  website?: string | null;
  location?: string | null;
  relationship?: string | null;
  status?: CrmRecordStatus;
  ownerId?: string | null;
  ownerRoleKey?: string | null;
  source?: string | null;
  sourceDetail?: string | null;
  nextFollowUpAt?: Date | string | null;
  keepInTouchDays?: number | null;
  doNotContact?: boolean;
  custom?: Record<string, unknown>;
  contactId?: string | null;
  userId?: string | null;
}

export interface WriteOptions {
  source?: HistorySource;
  batchId?: string | null;
  /** Skip the add-on check (setup and imports already asked). */
  trusted?: boolean;
}

const PERSON_SELECT = {
  id: true,
  name: true,
  firstName: true,
  lastName: true,
  primaryEmail: true,
  phone: true,
  title: true,
  companyId: true,
  linkedinUrl: true,
  website: true,
  location: true,
  relationship: true,
  status: true,
  ownerId: true,
  ownerRoleKey: true,
  source: true,
  sourceDetail: true,
  nextFollowUpAt: true,
  keepInTouchDays: true,
  doNotContact: true,
  custom: true,
  contactId: true,
  userId: true,
  deletedAt: true,
} satisfies Prisma.CrmPersonSelect;

type PersonRow = Prisma.CrmPersonGetPayload<{ select: typeof PERSON_SELECT }>;

/** The built-in values history records, by field key. */
function historyFields(p: Partial<PersonRow>): Record<string, unknown> {
  const { custom: _c, deletedAt: _d, id: _i, ...rest } = p as PersonRow;
  return rest;
}

async function findCompanyByName(actor: CrmActor, name: string): Promise<string> {
  const { db, organizationId, userId } = actor;
  const existing = await db.crmCompany.findFirst({
    where: { organizationId, deletedAt: null, name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await db.crmCompany.create({
    data: { organizationId, name: name.slice(0, 200), createdById: userId, updatedById: userId },
    select: { id: true },
  });
  return created.id;
}

/** The company whose domain an address belongs to (free mail matches nothing). */
async function companyForEmail(db: TxClient, organizationId: string, email: string | null) {
  const d = workDomain(email);
  if (!d) return null;
  const c = await db.crmCompany.findFirst({
    where: { organizationId, deletedAt: null, domain: d },
    select: { id: true },
  });
  return c?.id ?? null;
}

/** The workspace contact (check-ins) and member account an address belongs to. */
export async function workspaceMatch(
  db: TxClient,
  organizationId: string,
  email: string | null,
): Promise<{ contactId: string | null; userId: string | null }> {
  if (!email) return { contactId: null, userId: null };
  const contact = await db.contactEmail.findFirst({
    where: { organizationId, emailNormalized: email },
    select: { contactId: true },
  });
  const member = await db.membership.findFirst({
    where: { organizationId, user: { email: { equals: email, mode: "insensitive" } } },
    select: { userId: true },
  });
  return { contactId: contact?.contactId ?? null, userId: member?.userId ?? null };
}

/**
 * Sets a person's addresses: the primary and the others, each lowercased.
 * An address another live person has is refused (one person per address);
 * one left on a person in the trash moves over.
 */
export async function setPersonEmails(
  db: TxClient,
  organizationId: string,
  personId: string,
  primary: string | null,
  others: readonly string[] | undefined,
): Promise<void> {
  const current = await db.crmPersonEmail.findMany({
    where: { organizationId, personId },
    select: { id: true, email: true, isPrimary: true },
  });
  const wanted = new Map<string, boolean>();
  if (primary) wanted.set(primary, true);
  const otherList =
    others === undefined
      ? current.filter((e) => !e.isPrimary).map((e) => e.email)
      : others.map((o) => normalizeEmail(o)).filter((e): e is string => Boolean(e));
  for (const e of otherList) if (!wanted.has(e)) wanted.set(e, false);
  for (const [address, isPrimary] of wanted) {
    const owner = await db.crmPersonEmail.findFirst({
      where: { organizationId, email: address },
      select: { id: true, personId: true, person: { select: { name: true, deletedAt: true } } },
    });
    if (owner && owner.personId !== personId) {
      if (!owner.person.deletedAt) {
        throw new CrmError(`${address} is already ${owner.person.name}'s address.`, ["primaryEmail"]);
      }
      await db.crmPersonEmail.update({ where: { id: owner.id }, data: { personId, isPrimary } });
      continue;
    }
    if (owner) {
      await db.crmPersonEmail.update({ where: { id: owner.id }, data: { isPrimary } });
    } else {
      await db.crmPersonEmail.create({ data: { organizationId, personId, email: address, isPrimary } });
    }
  }
  const drop = current.filter((e) => !wanted.has(e.email)).map((e) => e.id);
  if (drop.length > 0) {
    await db.crmPersonEmail.deleteMany({ where: { organizationId, id: { in: drop } } });
  }
}

/** Closes the current job and opens one at the new company (job history). */
async function moveJob(
  db: TxClient,
  organizationId: string,
  personId: string,
  companyId: string | null,
  title: string | null,
): Promise<void> {
  const now = new Date();
  await db.crmJob.updateMany({
    where: { organizationId, personId, current: true },
    data: { current: false, endedOn: now },
  });
  if (!companyId) return;
  const company = await db.crmCompany.findFirst({
    where: { id: companyId, organizationId },
    select: { name: true },
  });
  await db.crmJob.create({
    data: {
      organizationId,
      personId,
      companyId,
      companyName: company?.name ?? null,
      title,
      startedOn: now,
      current: true,
    },
  });
}

interface CleanPerson {
  data: Record<string, unknown>;
  otherEmails?: string[];
  companyName?: string | null;
}

async function clean(actor: CrmActor, input: PersonInput, relationshipIds: Set<string> | null): Promise<CleanPerson> {
  const data: Record<string, unknown> = {
    name: n.text(input.name, 200),
    firstName: n.text(input.firstName, 100),
    lastName: n.text(input.lastName, 100),
    primaryEmail: n.email(input.primaryEmail),
    phone: n.phone(input.phone),
    title: n.text(input.title, 200),
    companyId: n.id(input.companyId),
    linkedinUrl: n.url(input.linkedinUrl, "LinkedIn"),
    website: n.url(input.website),
    location: n.text(input.location, 200),
    relationship: n.text(input.relationship, 64),
    status: input.status,
    ownerId: n.id(input.ownerId),
    ownerRoleKey: n.text(input.ownerRoleKey, 100),
    source: n.text(input.source, 100),
    sourceDetail: n.text(input.sourceDetail, 300),
    nextFollowUpAt: n.date(input.nextFollowUpAt, "Next follow-up"),
    keepInTouchDays: n.int(input.keepInTouchDays, "Keep in touch", 1, 3650),
    doNotContact: n.bool(input.doNotContact),
    contactId: n.id(input.contactId),
    userId: n.id(input.userId),
  };
  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];
  if (data.status !== undefined && !["ACTIVE", "INACTIVE", "ALUMNI"].includes(String(data.status))) {
    throw new CrmError("Pick Active, Inactive or Alumni.");
  }
  if (data.relationship && relationshipIds && !relationshipIds.has(String(data.relationship))) {
    throw new CrmError("Pick one of the relationship types in CRM settings.");
  }
  const { db, organizationId } = actor;
  if (data.ownerId) await requireMember(db, organizationId, String(data.ownerId));
  if (data.companyId) {
    const c = await db.crmCompany.findFirst({
      where: { id: String(data.companyId), organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!c) throw new CrmError("That company isn't in the CRM any more.");
  }
  return {
    data,
    otherEmails: input.otherEmails ? [...input.otherEmails] : undefined,
    companyName: n.text(input.companyName, 200),
  };
}

async function relationshipIdsOf(db: TxClient, organizationId: string): Promise<Set<string> | null> {
  const s = await db.crmSettings.findUnique({ where: { organizationId }, select: { relationshipTypes: true } });
  if (!s || !Array.isArray(s.relationshipTypes)) return null;
  return new Set(
    (s.relationshipTypes as { id?: unknown }[]).map((t) => (typeof t?.id === "string" ? t.id : "")).filter(Boolean),
  );
}

async function checkRequired(
  db: TxClient,
  organizationId: string,
  after: Record<string, unknown>,
  custom: Record<string, unknown>,
): Promise<void> {
  const ids = await crmDatabaseIds(db, organizationId);
  if (!ids.people) return;
  const def = await db.databaseDefinition.findFirst({
    where: { id: ids.people, organizationId },
    select: { columns: true },
  });
  const required = requiredKeys(def?.columns);
  if (required.length === 0) return;
  const values: Record<string, unknown> = {
    ...after,
    company: after.companyId,
    owner: after.ownerId ?? after.ownerRoleKey,
    ...custom,
  };
  const missing = required.filter((k) => {
    const v = values[k];
    return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
  });
  if (missing.length > 0) {
    const fields = await customFieldsFor(db, organizationId, "person");
    const names = missing.map((k) => fields.find((f) => f.id === k)?.name ?? k);
    throw new CrmError(`Add ${names.join(", ")} first.`, missing);
  }
}

/** Adds a person; returns their id. */
export async function createPerson(
  actor: CrmActor,
  input: PersonInput,
  options: WriteOptions = {},
): Promise<{ id: string }> {
  if (!options.trusted) await requireCrm(actor);
  const { db, organizationId, userId } = actor;
  const c = await clean(actor, input, await relationshipIdsOf(db, organizationId));
  const data = c.data;
  if (!data.firstName && !data.lastName && data.name) {
    const parts = splitName(String(data.name));
    data.firstName = parts.firstName;
    data.lastName = parts.lastName;
  }
  data.name = personName({
    name: data.name as string | null,
    firstName: data.firstName as string | null,
    lastName: data.lastName as string | null,
    email: data.primaryEmail as string | null,
  });
  if (!data.name) throw new CrmError("Give them a name or an email address.", ["name"]);
  if (!data.companyId && c.companyName) data.companyId = await findCompanyByName(actor, c.companyName);
  if (!data.companyId) data.companyId = await companyForEmail(db, organizationId, (data.primaryEmail as string) ?? null);
  if (data.primaryEmail && data.contactId === undefined && data.userId === undefined) {
    const match = await workspaceMatch(db, organizationId, data.primaryEmail as string);
    data.contactId = match.contactId;
    data.userId = match.userId;
  }
  const fields = await customFieldsFor(db, organizationId, "person");
  const custom = input.custom ? await checkCustomValues(db, organizationId, fields, {}, input.custom) : {};
  await checkRequired(db, organizationId, data, custom);
  if (data.ownerId === undefined && data.ownerRoleKey === undefined) data.ownerId = userId;

  const created = await db.crmPerson.create({
    data: {
      ...(data as Prisma.CrmPersonUncheckedCreateInput),
      name: data.name as string,
      organizationId,
      custom: custom as Prisma.InputJsonObject,
      createdById: userId,
      updatedById: userId,
    },
    select: { id: true },
  });
  await setPersonEmails(db, organizationId, created.id, (data.primaryEmail as string) ?? null, c.otherEmails ?? []);
  if (data.companyId) {
    await moveJob(db, organizationId, created.id, data.companyId as string, (data.title as string) ?? null);
  }
  await writeHistory(db, {
    organizationId,
    targetKind: "person",
    targetId: created.id,
    changes: [{ field: "created", oldValue: null, newValue: data.name }],
    userId,
    source: options.source,
    batchId: options.batchId,
  });
  return created;
}

/** Edits a person; returns the fields that changed. */
export async function updatePerson(
  actor: CrmActor,
  personId: string,
  input: PersonInput,
  options: WriteOptions = {},
): Promise<{ changed: string[] }> {
  if (!options.trusted) await requireCrm(actor);
  const { db, organizationId, userId } = actor;
  const before = await db.crmPerson.findFirst({
    where: { id: personId, organizationId },
    select: PERSON_SELECT,
  });
  if (!before) throw new CrmError("That person isn't in the CRM any more.");
  if (before.deletedAt) throw new CrmError("They're in the trash. Restore them first.");
  const c = await clean(actor, input, await relationshipIdsOf(db, organizationId));
  const data = c.data;
  if (!data.companyId && c.companyName) data.companyId = await findCompanyByName(actor, c.companyName);
  // Renaming the parts renames the person, unless a name was given too.
  if ((data.firstName !== undefined || data.lastName !== undefined) && data.name === undefined) {
    const first = data.firstName !== undefined ? data.firstName : before.firstName;
    const last = data.lastName !== undefined ? data.lastName : before.lastName;
    const joined = personName({ firstName: first as string | null, lastName: last as string | null });
    if (joined) data.name = joined;
  }
  if (data.name === null) throw new CrmError("Give them a name.", ["name"]);
  const fields = await customFieldsFor(db, organizationId, "person");
  const beforeCustom = (before.custom ?? {}) as Record<string, unknown>;
  const custom = input.custom
    ? await checkCustomValues(db, organizationId, fields, beforeCustom, input.custom)
    : beforeCustom;
  const afterFields = { ...historyFields(before), ...data };
  await checkRequired(db, organizationId, afterFields, custom);
  const changes = [...diffFields(historyFields(before), data), ...diffCustom(beforeCustom, custom)];
  if (changes.length === 0 && c.otherEmails === undefined) return { changed: [] };

  await db.crmPerson.update({
    where: { id: personId },
    data: {
      ...(data as Prisma.CrmPersonUncheckedUpdateInput),
      custom: custom as Prisma.InputJsonObject,
      updatedById: userId,
    },
  });
  if (data.primaryEmail !== undefined || c.otherEmails !== undefined) {
    const primary = data.primaryEmail !== undefined ? (data.primaryEmail as string | null) : before.primaryEmail;
    await setPersonEmails(db, organizationId, personId, primary, c.otherEmails);
  }
  if (data.companyId !== undefined && data.companyId !== before.companyId) {
    const title = (data.title !== undefined ? data.title : before.title) as string | null;
    await moveJob(db, organizationId, personId, (data.companyId as string) ?? null, title);
    if (before.companyId && data.companyId) {
      await logActivity(db, {
        organizationId,
        kind: "SYSTEM",
        subject: "Changed company",
        targets: [
          { kind: "person", id: personId },
          { kind: "company", id: before.companyId },
          { kind: "company", id: data.companyId as string },
        ],
        actorId: userId,
        createdById: userId,
        meta: { from: before.companyId, to: data.companyId },
      });
    }
  }
  await writeHistory(db, {
    organizationId,
    targetKind: "person",
    targetId: personId,
    changes,
    userId,
    source: options.source,
    batchId: options.batchId,
  });
  return { changed: changes.map((ch) => ch.field) };
}

/** Moves people to the trash (they keep everything; restore brings them back). */
export async function trashPeople(actor: CrmActor, ids: readonly string[], batchId?: string): Promise<number> {
  await requireCrm(actor);
  const { db, organizationId, userId } = actor;
  const rows = await db.crmPerson.findMany({
    where: { organizationId, id: { in: [...ids] }, deletedAt: null },
    select: { id: true },
  });
  const now = new Date();
  for (const r of rows) {
    await db.crmPerson.update({ where: { id: r.id }, data: { deletedAt: now, updatedById: userId } });
    await writeHistory(db, {
      organizationId,
      targetKind: "person",
      targetId: r.id,
      changes: [{ field: "deletedAt", oldValue: null, newValue: now }],
      userId,
      batchId,
    });
  }
  return rows.length;
}

export async function restorePeople(actor: CrmActor, ids: readonly string[]): Promise<number> {
  await requireCrm(actor);
  const { db, organizationId, userId } = actor;
  const rows = await db.crmPerson.findMany({
    where: { organizationId, id: { in: [...ids] }, deletedAt: { not: null } },
    select: { id: true, deletedAt: true },
  });
  for (const r of rows) {
    await db.crmPerson.update({ where: { id: r.id }, data: { deletedAt: null, updatedById: userId } });
    await writeHistory(db, {
      organizationId,
      targetKind: "person",
      targetId: r.id,
      changes: [{ field: "deletedAt", oldValue: r.deletedAt, newValue: null }],
      userId,
    });
  }
  return rows.length;
}

/** A person by an address (any of theirs), live or trashed. */
export async function personByEmail(
  db: TxClient,
  organizationId: string,
  address: string,
): Promise<{ id: string; deletedAt: Date | null } | null> {
  const e = normalizeEmail(address);
  if (!e) return null;
  const row = await db.crmPersonEmail.findFirst({
    where: { organizationId, email: e },
    select: { person: { select: { id: true, deletedAt: true } } },
  });
  return row?.person ?? null;
}
