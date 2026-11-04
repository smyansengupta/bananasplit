import type { CrmForecastCategory, Prisma } from "@/generated/prisma/client";
import { can } from "@/lib/auth/permissions";
import { builtinField, formatMoney } from "@/lib/crm/fields";
import { missingMessage } from "@/lib/crm/validate";
import { ensureActivePeriod } from "@/server/finance/periods";
import { createSponsorshipRecord } from "@/server/finance/sponsorship-create";
import { isSponsorshipStatus, setSponsorshipStatus } from "@/server/finance/sponsorship-status";
import type { TxClient } from "@/server/db/context";

import { CrmError, requireCrm, requireMember, type CrmActor } from "./access";
import { logActivity } from "./activity";
import { checkCustomValues, customFieldsFor } from "./databases";
import { diffCustom, diffFields, writeHistory } from "./history";
import * as n from "./normalize";
import type { WriteOptions } from "./people";

/**
 * Pipeline items (CrmDeal; on screen, the pipeline's own noun: an
 * applicant, a donation, a deal). A stage move checks the stage's
 * required fields (e.g. a reason on Lost) and asks for nothing else; the
 * move lands on the timeline. An item made from a Finance deal (a Sponsorship row) moves
 * through Finance's own code, so Received books the money exactly as
 * Finance does, and only finance roles can move it.
 */

export interface DealInput {
  pipelineId?: string;
  stageId?: string;
  title?: string | null;
  /** Dollars ("1500", 1500.5) or null. */
  amount?: number | string | null;
  expectedOn?: Date | string | null;
  ownerId?: string | null;
  ownerRoleKey?: string | null;
  companyId?: string | null;
  primaryPersonId?: string | null;
  nextStep?: string | null;
  nextStepAt?: Date | string | null;
  forecastCategory?: CrmForecastCategory;
  closeReason?: string | null;
  source?: string | null;
  custom?: Record<string, unknown>;
}

const DEAL_SELECT = {
  id: true,
  pipelineId: true,
  stageId: true,
  title: true,
  amountCents: true,
  expectedOn: true,
  ownerId: true,
  ownerRoleKey: true,
  companyId: true,
  primaryPersonId: true,
  nextStep: true,
  nextStepAt: true,
  forecastCategory: true,
  closeReason: true,
  source: true,
  custom: true,
  closedAt: true,
  sponsorshipId: true,
  rank: true,
  deletedAt: true,
} satisfies Prisma.CrmDealSelect;

type DealRow = Prisma.CrmDealGetPayload<{ select: typeof DEAL_SELECT }>;

function historyFields(d: DealRow): Record<string, unknown> {
  const { custom: _c, deletedAt: _d, id: _i, rank: _r, pipelineId: _p, sponsorshipId: _s, ...rest } = d;
  return rest;
}

async function stageOf(db: TxClient, organizationId: string, pipelineId: string, stageId: string) {
  const stage = await db.crmStage.findFirst({
    where: { id: stageId, organizationId, pipelineId },
    select: { id: true, name: true, key: true, kind: true, requiredFields: true },
  });
  if (!stage) throw new CrmError("That stage isn't in this pipeline any more.");
  return stage;
}

async function pipelineOf(db: TxClient, organizationId: string, pipelineId: string) {
  const p = await db.crmPipeline.findFirst({
    where: { id: pipelineId, organizationId, archivedAt: null },
    select: {
      id: true,
      name: true,
      itemNoun: true,
      currency: true,
      hasAmount: true,
      template: true,
      stages: { orderBy: { sortOrder: "asc" }, select: { id: true } },
    },
  });
  if (!p) throw new CrmError("That pipeline isn't here any more.");
  return p;
}

async function clean(actor: CrmActor, input: DealInput): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = {
    title: n.text(input.title, 200),
    amountCents: n.cents(input.amount),
    expectedOn: n.date(input.expectedOn, "Expected"),
    ownerId: n.id(input.ownerId),
    ownerRoleKey: n.text(input.ownerRoleKey, 100),
    companyId: n.id(input.companyId),
    primaryPersonId: n.id(input.primaryPersonId),
    nextStep: n.text(input.nextStep, 300),
    nextStepAt: n.date(input.nextStepAt, "Next step by"),
    forecastCategory: input.forecastCategory,
    closeReason: n.longText(input.closeReason),
    source: n.text(input.source, 100),
  };
  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];
  if (
    data.forecastCategory !== undefined &&
    !["PIPELINE", "BEST_CASE", "COMMIT", "OMITTED"].includes(String(data.forecastCategory))
  ) {
    throw new CrmError("Pick a forecast category.");
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
  if (data.primaryPersonId) {
    const p = await db.crmPerson.findFirst({
      where: { id: String(data.primaryPersonId), organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!p) throw new CrmError("That person isn't in the CRM any more.");
  }
  return data;
}

/** The required fields a stage asks for that `values` leaves empty, as labels. */
export async function stageMissing(
  db: TxClient,
  organizationId: string,
  pipelineId: string,
  required: readonly string[],
  values: Record<string, unknown>,
): Promise<{ keys: string[]; labels: string[] }> {
  if (required.length === 0) return { keys: [], labels: [] };
  const fields = await customFieldsFor(db, organizationId, "deal", pipelineId);
  const keyed: Record<string, unknown> = {
    ...values,
    amount: values.amountCents,
    company: values.companyId,
    person: values.primaryPersonId,
    owner: values.ownerId ?? values.ownerRoleKey,
    ...(values.custom as Record<string, unknown> | undefined),
  };
  const keys = required.filter((k) => {
    const v = keyed[k];
    return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
  });
  const labels = keys.map(
    (k) => builtinField("deal", k)?.label ?? fields.find((f) => f.id === k)?.name ?? k,
  );
  return { keys, labels };
}

export async function createDeal(
  actor: CrmActor,
  input: DealInput & { pipelineId: string; people?: readonly string[] },
  options: WriteOptions = {},
): Promise<{ id: string }> {
  if (!options.trusted) await requireCrm(actor);
  const { db, organizationId, userId } = actor;
  const pipeline = await pipelineOf(db, organizationId, input.pipelineId);
  const stageId = input.stageId ?? pipeline.stages[0]?.id;
  if (!stageId) throw new CrmError("Add a stage to this pipeline first.");
  const stage = await stageOf(db, organizationId, pipeline.id, stageId);
  const data = await clean(actor, input);
  if (!data.title) throw new CrmError(`Give the ${pipeline.itemNoun} a title.`, ["title"]);
  const fields = await customFieldsFor(db, organizationId, "deal", pipeline.id);
  const custom = input.custom ? await checkCustomValues(db, organizationId, fields, {}, input.custom) : {};
  const missing = await stageMissing(db, organizationId, pipeline.id, stage.requiredFields, { ...data, custom });
  if (missing.keys.length > 0) throw new CrmError(missingMessage(missing.labels, stage.name), missing.keys);
  if (data.ownerId === undefined && data.ownerRoleKey === undefined) data.ownerId = userId;
  // The Deals pipeline (template "sponsors") is Finance's deals: a new item there is a new
  // Finance deal too, made through Finance's own code, so the two stay in step.
  const sponsorshipId =
    pipeline.template === "sponsors"
      ? await sponsorshipFor(actor, { ...data, stageKey: stage.key, itemNoun: pipeline.itemNoun })
      : null;
  const last = await db.crmDeal.aggregate({
    where: { organizationId, pipelineId: pipeline.id, stageId },
    _max: { rank: true },
  });
  const created = await db.crmDeal.create({
    data: {
      ...(data as Prisma.CrmDealUncheckedCreateInput),
      ...(sponsorshipId ? { sponsorshipId } : {}),
      title: String(data.title),
      organizationId,
      pipelineId: pipeline.id,
      stageId,
      currency: pipeline.currency,
      closedAt: stage.kind === "OPEN" ? null : new Date(),
      rank: (last._max.rank ?? 0) + 1,
      custom: custom as Prisma.InputJsonObject,
      createdById: userId,
      updatedById: userId,
    },
    select: { id: true },
  });
  const people = new Set(input.people ?? []);
  if (data.primaryPersonId) people.add(String(data.primaryPersonId));
  for (const personId of people) {
    await addDealPerson(actor, created.id, personId, null, { trusted: true });
  }
  await writeHistory(db, {
    organizationId,
    targetKind: "deal",
    targetId: created.id,
    changes: [{ field: "created", oldValue: null, newValue: data.title }],
    userId,
    source: options.source,
    batchId: options.batchId,
  });
  return created;
}

/** Finance's deal for a new Deals item (and its partner, from the company). */
async function sponsorshipFor(
  actor: CrmActor,
  data: Record<string, unknown> & { stageKey: string | null; itemNoun: string },
): Promise<string> {
  const { db, organizationId, userId } = actor;
  if (!can(actor, "finance.manage")) {
    throw new CrmError("A new deal here goes into Finance's books, so owners and treasurers add them. Ask one, or add it in Finance.");
  }
  if (!data.companyId) throw new CrmError("Pick the company the deal is with.", ["companyId"]);
  const amount = typeof data.amountCents === "number" ? data.amountCents : null;
  if (!amount || amount <= 0) throw new CrmError(`Give the ${data.itemNoun} an amount.`, ["amount"]);
  const company = await db.crmCompany.findFirst({
    where: { id: String(data.companyId), organizationId },
    select: { id: true, name: true, sponsorId: true, description: true },
  });
  if (!company) throw new CrmError("That company isn't in the CRM any more.");
  let sponsorId = company.sponsorId;
  if (!sponsorId) {
    const contact = data.primaryPersonId
      ? await db.crmPerson.findFirst({ where: { id: String(data.primaryPersonId), organizationId }, select: { name: true, primaryEmail: true } })
      : null;
    const same = await db.sponsor.findFirst({
      where: { organizationId, name: { equals: company.name, mode: "insensitive" } },
      select: { id: true },
    });
    sponsorId =
      same?.id ??
      (
        await db.sponsor.create({
          data: {
            organizationId,
            name: company.name.slice(0, 200),
            contactName: contact?.name ?? null,
            contactEmail: contact?.primaryEmail ?? null,
            notes: company.description?.slice(0, 2000) ?? null,
          },
          select: { id: true },
        })
      ).id;
    await db.crmCompany.updateMany({ where: { id: company.id, organizationId }, data: { sponsorId } });
  }
  const period = await ensureActivePeriod(db, organizationId);
  const ownerId = typeof data.ownerId === "string" ? data.ownerId : userId;
  const made = await createSponsorshipRecord(
    { db, organizationId, userId },
    {
      sponsorId,
      budgetPeriodId: period.id,
      amountCents: amount,
      expectedOn: data.expectedOn instanceof Date ? data.expectedOn : null,
      ownerId,
      status: data.stageKey && isSponsorshipStatus(data.stageKey) ? data.stageKey : undefined,
    },
    { fromCrm: true },
  );
  if (made.error || !made.sponsorshipId) throw new CrmError(made.error ?? "Finance couldn't take that deal.");
  return made.sponsorshipId;
}

export async function updateDeal(
  actor: CrmActor,
  dealId: string,
  input: DealInput,
  options: WriteOptions = {},
): Promise<{ changed: string[] }> {
  if (!options.trusted) await requireCrm(actor);
  const { db, organizationId, userId } = actor;
  const before = await db.crmDeal.findFirst({ where: { id: dealId, organizationId }, select: DEAL_SELECT });
  if (!before) throw new CrmError("That deal isn't here any more.");
  if (before.deletedAt) throw new CrmError("It's in the trash. Restore it first.");
  if (input.stageId && input.stageId !== before.stageId) {
    // A stage change goes through the move (required fields, Finance).
    const moved = await moveDeal(
      actor,
      dealId,
      { stageId: input.stageId, closeReason: input.closeReason },
      options,
    );
    if (moved.needs) throw new CrmError(missingMessage(moved.needs.labels), moved.needs.keys);
  }
  const data = await clean(actor, { ...input, closeReason: input.stageId ? undefined : input.closeReason });
  if (data.title === null) throw new CrmError("Give it a title.", ["title"]);
  if (before.sponsorshipId && (data.amountCents !== undefined || data.expectedOn !== undefined)) {
    if (!can(actor, "finance.manage")) {
      throw new CrmError("The amount and date of a Finance deal are Finance's: ask a treasurer.");
    }
  }
  const fields = await customFieldsFor(db, organizationId, "deal", before.pipelineId);
  const beforeCustom = (before.custom ?? {}) as Record<string, unknown>;
  const custom = input.custom
    ? await checkCustomValues(db, organizationId, fields, beforeCustom, input.custom)
    : beforeCustom;
  const changes = [...diffFields(historyFields(before), data), ...diffCustom(beforeCustom, custom)];
  if (changes.length === 0) return { changed: [] };
  // Emptying a field the current stage requires isn't allowed either.
  const stage = await stageOf(db, organizationId, before.pipelineId, input.stageId ?? before.stageId);
  const missing = await stageMissing(db, organizationId, before.pipelineId, stage.requiredFields, {
    ...historyFields(before),
    ...data,
    custom,
  });
  if (missing.keys.length > 0) throw new CrmError(missingMessage(missing.labels), missing.keys);
  await db.crmDeal.update({
    where: { id: dealId },
    data: {
      ...(data as Prisma.CrmDealUncheckedUpdateInput),
      custom: custom as Prisma.InputJsonObject,
      updatedById: userId,
    },
  });
  if (before.sponsorshipId && (data.amountCents !== undefined || data.expectedOn !== undefined)) {
    // Finance's own edit rules: a reconciled payment's amount stays put.
    const money = await db.sponsorship.findFirst({
      where: { id: before.sponsorshipId, organizationId },
      select: { transaction: { select: { reconciledAt: true, voidedAt: true, id: true } } },
    });
    const amount = data.amountCents as number | null | undefined;
    if (amount !== undefined && amount !== null && amount > 0) {
      if (money?.transaction && !money.transaction.voidedAt) {
        if (money.transaction.reconciledAt) {
          throw new CrmError("The money it booked is reconciled. Unlock it under Transactions first.");
        }
        await db.transaction.update({ where: { id: money.transaction.id }, data: { amountCents: amount } });
      }
      await db.sponsorship.update({ where: { id: before.sponsorshipId }, data: { amountCents: amount } });
    }
    if (data.expectedOn !== undefined) {
      await db.sponsorship.update({
        where: { id: before.sponsorshipId },
        data: { expectedOn: data.expectedOn as Date | null },
      });
    }
  }
  await writeHistory(db, {
    organizationId,
    targetKind: "deal",
    targetId: dealId,
    changes,
    userId,
    source: options.source,
    batchId: options.batchId,
  });
  return { changed: changes.map((c) => c.field) };
}

export interface MoveInput {
  stageId: string;
  /** Board order: put it between these two (either may be absent). */
  beforeId?: string | null;
  afterId?: string | null;
  /** The reason asked for on the closing stages. */
  closeReason?: string | null;
  /** Values the stage asked for, filled in the same step. */
  fill?: DealInput;
}

export interface MoveResult {
  /** Fields the stage needs that are still empty (nothing moved). */
  needs?: { keys: string[]; labels: string[] };
}

/** Moves an item to a stage (and a place on the board). */
export async function moveDeal(
  actor: CrmActor,
  dealId: string,
  input: MoveInput,
  options: WriteOptions = {},
): Promise<MoveResult> {
  if (!options.trusted) await requireCrm(actor);
  const { db, organizationId, userId } = actor;
  const deal = await db.crmDeal.findFirst({ where: { id: dealId, organizationId }, select: DEAL_SELECT });
  if (!deal) throw new CrmError("That deal isn't here any more.");
  if (deal.deletedAt) throw new CrmError("It's in the trash. Restore it first.");
  const stage = await stageOf(db, organizationId, deal.pipelineId, input.stageId);
  const fill = input.fill ? await clean(actor, input.fill) : {};
  const closeReason = n.longText(input.closeReason);
  const after = {
    ...historyFields(deal),
    ...fill,
    ...(closeReason !== undefined ? { closeReason } : {}),
    custom: deal.custom,
  };
  if (input.fill?.custom) {
    const fields = await customFieldsFor(db, organizationId, "deal", deal.pipelineId);
    after.custom = await checkCustomValues(
      db,
      organizationId,
      fields,
      (deal.custom ?? {}) as Record<string, unknown>,
      input.fill.custom,
    ) as Prisma.JsonValue;
  }
  const missing = await stageMissing(db, organizationId, deal.pipelineId, stage.requiredFields, after);
  if (missing.keys.length > 0) return { needs: missing };

  const stageChanged = stage.id !== deal.stageId;
  if (stageChanged && deal.sponsorshipId && stage.key && isSponsorshipStatus(stage.key)) {
    if (!can(actor, "finance.manage")) {
      throw new CrmError(
        "Moving a Finance deal changes the books, so owners, admins and treasurers move it.",
      );
    }
    const moved = await setSponsorshipStatus(actor, deal.sponsorshipId, stage.key, { fromCrm: true });
    if (moved.error) throw new CrmError(moved.error);
  }

  const rank = await rankBetween(db, organizationId, deal.pipelineId, stage.id, input.beforeId, input.afterId);
  const closing = stage.kind !== "OPEN";
  await db.crmDeal.update({
    where: { id: dealId },
    data: {
      stageId: stage.id,
      rank,
      ...(fill as Prisma.CrmDealUncheckedUpdateInput),
      ...(closeReason !== undefined ? { closeReason } : {}),
      ...(input.fill?.custom ? { custom: after.custom as Prisma.InputJsonObject } : {}),
      ...(stageChanged
        ? { stageEnteredAt: new Date(), closedAt: closing ? new Date() : null }
        : {}),
      updatedById: userId,
    },
  });
  if (stageChanged) {
    const from = await db.crmStage.findFirst({
      where: { id: deal.stageId, organizationId },
      select: { name: true },
    });
    const changes = [
      { field: "stageId", oldValue: deal.stageId, newValue: stage.id },
      ...diffFields(historyFields(deal), { ...fill, ...(closeReason !== undefined ? { closeReason } : {}) }),
    ];
    await writeHistory(db, {
      organizationId,
      targetKind: "deal",
      targetId: dealId,
      changes,
      userId,
      source: options.source,
      batchId: options.batchId,
    });
    const people = await db.crmDealPerson.findMany({
      where: { organizationId, dealId },
      select: { personId: true },
    });
    await logActivity(db, {
      organizationId,
      kind: "STAGE_CHANGE",
      subject: `${from?.name ?? "A stage"} to ${stage.name}`,
      body: closeReason ?? null,
      targets: [
        { kind: "deal", id: dealId },
        ...(deal.companyId ? [{ kind: "company" as const, id: deal.companyId }] : []),
        ...people.map((p) => ({ kind: "person" as const, id: p.personId })),
      ],
      actorId: userId,
      createdById: userId,
      meta: {
        from: deal.stageId,
        to: stage.id,
        kind: stage.kind,
        ...(deal.amountCents ? { amount: formatMoney(deal.amountCents) } : {}),
      },
    });
  }
  return {};
}

/** A rank between two board neighbours (or after the last one). */
async function rankBetween(
  db: TxClient,
  organizationId: string,
  pipelineId: string,
  stageId: string,
  beforeId?: string | null,
  afterId?: string | null,
): Promise<number> {
  const rankOf = async (id?: string | null) => {
    if (!id) return null;
    const r = await db.crmDeal.findFirst({
      where: { id, organizationId, pipelineId },
      select: { rank: true },
    });
    return r?.rank ?? null;
  };
  const lo = await rankOf(afterId);
  const hi = await rankOf(beforeId);
  if (lo !== null && hi !== null) return (lo + hi) / 2;
  if (hi !== null) return hi - 1;
  if (lo !== null) return lo + 1;
  const last = await db.crmDeal.aggregate({
    where: { organizationId, pipelineId, stageId, deletedAt: null },
    _max: { rank: true },
  });
  return (last._max.rank ?? 0) + 1;
}

export async function addDealPerson(
  actor: CrmActor,
  dealId: string,
  personId: string,
  role: string | null,
  options: WriteOptions = {},
): Promise<void> {
  if (!options.trusted) await requireCrm(actor);
  const { db, organizationId } = actor;
  const person = await db.crmPerson.findFirst({
    where: { id: personId, organizationId, deletedAt: null },
    select: { id: true },
  });
  if (!person) throw new CrmError("That person isn't in the CRM any more.");
  const deal = await db.crmDeal.findFirst({ where: { id: dealId, organizationId }, select: { id: true } });
  if (!deal) throw new CrmError("That deal isn't here any more.");
  await db.crmDealPerson.upsert({
    where: { dealId_personId: { dealId, personId } },
    create: { organizationId, dealId, personId, role: role?.slice(0, 60) ?? null },
    update: { role: role?.slice(0, 60) ?? null },
  });
}

export async function removeDealPerson(actor: CrmActor, dealId: string, personId: string): Promise<void> {
  await requireCrm(actor);
  await actor.db.crmDealPerson.deleteMany({
    where: { organizationId: actor.organizationId, dealId, personId },
  });
  await actor.db.crmDeal.updateMany({
    where: { organizationId: actor.organizationId, id: dealId, primaryPersonId: personId },
    data: { primaryPersonId: null },
  });
}

export async function trashDeals(actor: CrmActor, ids: readonly string[], batchId?: string): Promise<number> {
  await requireCrm(actor);
  const { db, organizationId, userId } = actor;
  const rows = await db.crmDeal.findMany({
    where: { organizationId, id: { in: [...ids] }, deletedAt: null },
    select: { id: true, sponsorshipId: true },
  });
  if (rows.some((r) => r.sponsorshipId)) {
    throw new CrmError("A deal from Finance is deleted in Finance, so the books stay right.");
  }
  const now = new Date();
  for (const r of rows) {
    await db.crmDeal.update({ where: { id: r.id }, data: { deletedAt: now, updatedById: userId } });
    await writeHistory(db, {
      organizationId,
      targetKind: "deal",
      targetId: r.id,
      changes: [{ field: "deletedAt", oldValue: null, newValue: now }],
      userId,
      batchId,
    });
  }
  return rows.length;
}

export async function restoreDeals(actor: CrmActor, ids: readonly string[]): Promise<number> {
  await requireCrm(actor);
  const { db, organizationId, userId } = actor;
  const rows = await db.crmDeal.findMany({
    where: { organizationId, id: { in: [...ids] }, deletedAt: { not: null } },
    select: { id: true, deletedAt: true },
  });
  for (const r of rows) {
    await db.crmDeal.update({ where: { id: r.id }, data: { deletedAt: null, updatedById: userId } });
    await writeHistory(db, {
      organizationId,
      targetKind: "deal",
      targetId: r.id,
      changes: [{ field: "deletedAt", oldValue: r.deletedAt, newValue: null }],
      userId,
    });
  }
  return rows.length;
}
