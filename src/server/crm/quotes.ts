import { createHash, randomBytes } from "node:crypto";

import type { Prisma, Role } from "@/generated/prisma/client";
import { readAddOns } from "@/lib/addons";
import { can } from "@/lib/auth/permissions";
import { spaceIncludes } from "@/lib/billing/space";
import { formatMoney } from "@/lib/crm/fields";
import {
  canRespond,
  cleanLines,
  cleanSignature,
  effectiveStatus,
  KIND_WORD,
  nextQuoteNumber,
  parsePublicToken,
  QuoteInputError,
  quoteTotals,
  type LineInput,
  type QuoteKind,
  type QuoteStatus,
} from "@/lib/crm/quotes";
import { writeFinanceAuditLog } from "@/lib/finance/audit";
import { ensureActivePeriod } from "@/server/finance/periods";
import { withSystemOrgTx, type TxClient } from "@/server/db/context";

import { CrmError, type CrmActor } from "./access";
import { logActivity, type ActivityTarget } from "./activity";
import { moveDeal } from "./deals";

/**
 * Quotes and invoices (docs/features/crm.md, CrmQuote): built on a pipeline
 * item, a company or a person, with lines in integer cents, tax, currency,
 * notes and a valid-until (a due date on an invoice). Numbered per
 * organization and kind (Q-0001, INV-0001) under a transaction lock, so two
 * members never get the same number.
 *
 * Sending makes a public link /q/{token}; only the token's hash is kept,
 * and sending again makes a new link (the old one stops working). The
 * recipient reads it, downloads the PDF, and accepts by typing their name
 * (the name, the time and a hash of their IP are kept), or declines. A
 * quote past its date can't be accepted. An accepted quote on an item moves
 * the item to its won stage through the CRM's own moveDeal, so Finance and
 * automations run as for any move. Marking an invoice paid can book a
 * Finance income transaction through Finance's own rules. A quote can be
 * copied, made into an invoice, or moved to another item.
 */

export interface QuoteDraftInput {
  kind?: QuoteKind;
  dealId?: string | null;
  companyId?: string | null;
  personId?: string | null;
  title?: string | null;
}

export interface QuoteSaveInput {
  title?: string;
  notes?: string | null;
  currency?: string;
  validUntil?: string | null;
  taxBps?: number;
  lines?: Partial<LineInput>[];
}

const CURRENCY = /^[A-Z]{3}$/;

function fromQuoteError<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof QuoteInputError) throw new CrmError(error.message);
    throw error;
  }
}

/** The next number of a kind, under a lock held until the transaction ends. */
export async function nextNumber(db: TxClient, organizationId: string, kind: QuoteKind): Promise<string> {
  const lockKey = `crm-quote:${organizationId}:${kind}`;
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text AS locked`;
  const rows = await db.crmQuote.findMany({
    where: { organizationId, kind, number: { startsWith: `${KIND_WORD[kind].prefix}-` } },
    select: { number: true },
  });
  return nextQuoteNumber(kind, rows.map((r) => r.number));
}

/** Who a quote is for, from the item (its company and first person) or what was given. */
async function partiesOf(db: TxClient, organizationId: string, input: QuoteDraftInput) {
  let dealId = input.dealId ?? null;
  let companyId = input.companyId ?? null;
  let personId = input.personId ?? null;
  let title: string | null = null;
  let currency = "USD";
  let amountCents: number | null = null;
  if (dealId) {
    const deal = await db.crmDeal.findFirst({
      where: { id: dealId, organizationId, deletedAt: null },
      select: { id: true, title: true, companyId: true, primaryPersonId: true, currency: true, amountCents: true },
    });
    if (!deal) throw new CrmError("That item isn't in the CRM any more.");
    dealId = deal.id;
    companyId = companyId ?? deal.companyId;
    personId = personId ?? deal.primaryPersonId;
    title = deal.title;
    currency = deal.currency || "USD";
    amountCents = deal.amountCents;
  }
  if (companyId) {
    const c = await db.crmCompany.findFirst({ where: { id: companyId, organizationId }, select: { id: true, name: true } });
    if (!c) throw new CrmError("That company isn't in the CRM any more.");
    title = title ?? c.name;
  }
  if (personId) {
    const p = await db.crmPerson.findFirst({
      where: { id: personId, organizationId },
      select: { id: true, name: true, companyId: true },
    });
    if (!p) throw new CrmError("That person isn't in the CRM any more.");
    companyId = companyId ?? p.companyId;
    title = title ?? p.name;
  }
  if (!dealId && !companyId && !personId) throw new CrmError("Make it for an item, a company or a person.");
  return { dealId, companyId, personId, title, currency, amountCents };
}

function targetsOf(q: { dealId: string | null; companyId: string | null; personId: string | null }): ActivityTarget[] {
  return [
    ...(q.dealId ? [{ kind: "deal" as const, id: q.dealId }] : []),
    ...(q.companyId ? [{ kind: "company" as const, id: q.companyId }] : []),
    ...(q.personId ? [{ kind: "person" as const, id: q.personId }] : []),
  ];
}

async function logQuote(
  db: TxClient,
  organizationId: string,
  q: { id: string; number: string; kind: string; title: string; totalCents: number; currency: string; dealId: string | null; companyId: string | null; personId: string | null },
  event: "sent" | "accepted" | "declined" | "paid" | "made",
  actorId: string | null,
  body?: string | null,
) {
  const word = KIND_WORD[q.kind as QuoteKind] ?? KIND_WORD.quote;
  const verb = { sent: "sent", accepted: "accepted", declined: "declined", paid: "paid", made: "made" }[event];
  const targets = targetsOf(q);
  if (targets.length === 0) return;
  await logActivity(db, {
    organizationId,
    kind: event === "paid" ? "PAYMENT" : "SYSTEM",
    subject: `${word.title} ${q.number} ${verb}: ${formatMoney(q.totalCents, q.currency)}`,
    body: body ?? q.title,
    actorId,
    createdById: actorId,
    sourceKind: "quote",
    sourceId: `${q.id}:${event}:${Date.now().toString(36)}`,
    targets,
    meta: { quoteId: q.id, number: q.number, event, amount: formatMoney(q.totalCents, q.currency) },
  });
}

/** A new draft; returns its id. */
export async function createQuote(actor: CrmActor, input: QuoteDraftInput): Promise<{ id: string; number: string }> {
  const { db, organizationId, userId } = actor;
  const kind: QuoteKind = input.kind === "invoice" ? "invoice" : "quote";
  const parties = await partiesOf(db, organizationId, input);
  const number = await nextNumber(db, organizationId, kind);
  const title = (input.title?.trim() || parties.title || KIND_WORD[kind].title).slice(0, 200);
  const validUntil = new Date(Date.now() + (kind === "quote" ? 30 : 14) * 86_400_000);
  validUntil.setUTCHours(0, 0, 0, 0);
  const lines = parties.amountCents ? [{ description: title, quantity: 1, unitCents: parties.amountCents }] : [];
  const totals = quoteTotals(lines);
  const quote = await db.crmQuote.create({
    data: {
      organizationId,
      kind,
      number,
      title,
      dealId: parties.dealId,
      companyId: parties.companyId,
      personId: parties.personId,
      currency: parties.currency,
      validUntil,
      totalCents: totals.totalCents,
      createdById: userId,
      lines: {
        create: lines.map((l, i) => ({ organizationId, ...l, sortOrder: i })),
      },
    },
    select: { id: true, number: true },
  });
  return quote;
}

async function editable(db: TxClient, organizationId: string, id: string) {
  const q = await db.crmQuote.findFirst({ where: { id, organizationId } });
  if (!q) throw new CrmError("That quote isn't here any more.");
  return q;
}

/** Saves a draft's text, dates and lines. A sent one goes back to draft (its link stops working). */
export async function saveQuote(actor: CrmActor, id: string, input: QuoteSaveInput): Promise<{ totalCents: number }> {
  const { db, organizationId } = actor;
  const q = await editable(db, organizationId, id);
  if (q.status === "ACCEPTED" || q.status === "PAID") {
    throw new CrmError("It's been accepted or paid, so it can't change. Copy it to make a new one.");
  }
  const data: Prisma.CrmQuoteUpdateInput = {};
  if (input.title !== undefined) {
    const t = input.title.trim().slice(0, 200);
    if (!t) throw new CrmError("Give it a title.");
    data.title = t;
  }
  if (input.notes !== undefined) data.notes = input.notes?.trim().slice(0, 5000) || null;
  if (input.currency !== undefined) {
    const c = input.currency.trim().toUpperCase();
    if (!CURRENCY.test(c)) throw new CrmError("Use a three-letter currency like USD.");
    data.currency = c;
  }
  if (input.validUntil !== undefined) {
    if (input.validUntil === null || input.validUntil === "") data.validUntil = null;
    else {
      const d = new Date(input.validUntil);
      if (Number.isNaN(d.getTime())) throw new CrmError("Pick a real date.");
      data.validUntil = d;
    }
  }
  if (input.taxBps !== undefined) {
    if (!Number.isInteger(input.taxBps) || input.taxBps < 0 || input.taxBps > 10_000) throw new CrmError("Tax is a rate from 0 to 100%.");
    data.taxBps = input.taxBps;
  }
  let lines: LineInput[] | null = null;
  if (input.lines !== undefined) lines = fromQuoteError(() => cleanLines(input.lines!));
  const current = lines ?? (await db.crmQuoteLine.findMany({ where: { organizationId, quoteId: q.id }, orderBy: { sortOrder: "asc" } }));
  const totals = quoteTotals(current, (data.taxBps as number | undefined) ?? q.taxBps);
  data.totalCents = totals.totalCents;
  if (q.status !== "DRAFT") {
    data.status = "DRAFT";
    data.publicTokenHash = null;
    data.sentAt = null;
    data.declinedAt = null;
    data.declineReason = null;
  }
  await db.crmQuote.update({ where: { id: q.id }, data });
  if (lines) {
    await db.crmQuoteLine.deleteMany({ where: { organizationId, quoteId: q.id } });
    if (lines.length) {
      await db.crmQuoteLine.createMany({
        data: lines.map((l, i) => ({ organizationId, quoteId: q.id, ...l, sortOrder: i })),
      });
    }
  }
  return { totalCents: totals.totalCents };
}

export function hashQuoteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Makes (or remakes) the public link; returns the token, shown to the member once. */
export async function sendQuote(actor: CrmActor, id: string): Promise<{ token: string }> {
  const { db, organizationId, userId } = actor;
  const q = await editable(db, organizationId, id);
  if (q.status === "ACCEPTED" || q.status === "PAID") throw new CrmError("It's already been accepted.");
  const lines = await db.crmQuoteLine.count({ where: { organizationId, quoteId: q.id } });
  if (lines === 0) throw new CrmError("Add a line first.");
  const token = `${organizationId}.${randomBytes(32).toString("base64url")}`;
  await db.crmQuote.update({
    where: { id: q.id },
    data: { status: "SENT", sentAt: new Date(), publicTokenHash: hashQuoteToken(token), declinedAt: null, declineReason: null },
  });
  await logQuote(db, organizationId, q, "sent", userId);
  return { token };
}

/** Copies a quote (to the same item or another), or makes an invoice from it. */
export async function duplicateQuote(
  actor: CrmActor,
  id: string,
  input: { dealId?: string | null; kind?: QuoteKind } = {},
): Promise<{ id: string; number: string }> {
  const { db, organizationId, userId } = actor;
  const q = await editable(db, organizationId, id);
  const kind: QuoteKind = input.kind ?? (q.kind === "invoice" ? "invoice" : "quote");
  const parties =
    input.dealId !== undefined && input.dealId !== q.dealId
      ? await partiesOf(db, organizationId, { dealId: input.dealId })
      : { dealId: q.dealId, companyId: q.companyId, personId: q.personId };
  const lines = await db.crmQuoteLine.findMany({ where: { organizationId, quoteId: q.id }, orderBy: { sortOrder: "asc" } });
  const number = await nextNumber(db, organizationId, kind);
  const validUntil = new Date(Date.now() + (kind === "quote" ? 30 : 14) * 86_400_000);
  validUntil.setUTCHours(0, 0, 0, 0);
  const made = await db.crmQuote.create({
    data: {
      organizationId,
      kind,
      number,
      title: q.title,
      notes: q.notes,
      currency: q.currency,
      taxBps: q.taxBps,
      totalCents: q.totalCents,
      validUntil,
      dealId: parties.dealId,
      companyId: parties.companyId,
      personId: parties.personId,
      createdById: userId,
      lines: {
        create: lines.map((l) => ({
          organizationId,
          description: l.description,
          quantity: l.quantity,
          unitCents: l.unitCents,
          sortOrder: l.sortOrder,
        })),
      },
    },
    select: { id: true, number: true },
  });
  return made;
}

/** Moves a quote onto another item (its company and person follow the item). */
export async function moveQuote(actor: CrmActor, id: string, dealId: string): Promise<void> {
  const { db, organizationId, userId } = actor;
  const q = await editable(db, organizationId, id);
  if (q.dealId === dealId) return;
  const parties = await partiesOf(db, organizationId, { dealId });
  await db.crmQuote.update({
    where: { id: q.id },
    data: { dealId: parties.dealId, companyId: parties.companyId ?? q.companyId, personId: parties.personId ?? q.personId },
  });
  await logActivity(db, {
    organizationId,
    kind: "SYSTEM",
    subject: `${KIND_WORD[(q.kind as QuoteKind) ?? "quote"].title} ${q.number} moved here`,
    actorId: userId,
    createdById: userId,
    targets: [{ kind: "deal", id: dealId }, ...(q.dealId ? [{ kind: "deal" as const, id: q.dealId }] : [])],
    meta: { quoteId: q.id, from: q.dealId, to: dealId },
  });
}

/**
 * Marks an invoice (or an accepted quote) paid. With `book`, a finance
 * role records the income in Finance (the active budget period; Finance's
 * audit log), once.
 */
export async function markPaid(actor: CrmActor, id: string, input: { book?: boolean } = {}): Promise<{ booked: boolean }> {
  const { db, organizationId, userId } = actor;
  const q = await editable(db, organizationId, id);
  if (q.status === "PAID") return { booked: Boolean(q.financeTransactionId) };
  if (q.status === "DRAFT" || q.status === "DECLINED") throw new CrmError("Send it first.");
  let transactionId: string | null = null;
  if (input.book) {
    if (!can(actor, "finance.manage")) throw new CrmError("Owners, admins and treasurers book money in Finance.");
    const org = await db.organization.findUnique({
      where: { id: organizationId },
      select: { kind: true, plan: true, trialEndsAt: true, planAfterTrial: true },
    });
    const settings = await db.orgSettings.findUnique({ where: { organizationId }, select: { addOns: true } });
    if (!org || !spaceIncludes(org, "finance") || !readAddOns(settings?.addOns).includes("finance")) {
      throw new CrmError("Add Finance on Integrations and apps to book it there.");
    }
    if (q.totalCents <= 0) throw new CrmError("There's nothing to book.");
    const period = await ensureActivePeriod(db, organizationId);
    const company = q.companyId
      ? await db.crmCompany.findFirst({ where: { id: q.companyId, organizationId }, select: { name: true } })
      : null;
    const tx = await db.transaction.create({
      data: {
        organizationId,
        budgetPeriodId: period.id,
        direction: "IN",
        kind: "OTHER_INCOME",
        amountCents: q.totalCents,
        description: `${KIND_WORD[(q.kind as QuoteKind) ?? "quote"].title} ${q.number}: ${q.title}`.slice(0, 300),
        counterparty: company?.name ?? null,
        occurredAt: new Date(),
        submittedById: userId,
        status: "NOT_APPLICABLE",
      },
    });
    await writeFinanceAuditLog(db, { organizationId, transactionId: tx.id, action: "CREATE", after: tx });
    transactionId = tx.id;
  }
  await db.crmQuote.update({
    where: { id: q.id },
    data: { status: "PAID", paidAt: new Date(), ...(transactionId ? { financeTransactionId: transactionId } : {}) },
  });
  await logQuote(db, organizationId, q, "paid", userId, transactionId ? "Booked in Finance." : null);
  return { booked: Boolean(transactionId) };
}

/** Moves an accepted quote's item to its won stage (the first one), through moveDeal. */
export async function moveToWon(actor: CrmActor, quote: { dealId: string | null }): Promise<{ moved: boolean; note?: string }> {
  const { db, organizationId } = actor;
  if (!quote.dealId) return { moved: false };
  const deal = await db.crmDeal.findFirst({
    where: { id: quote.dealId, organizationId, deletedAt: null },
    select: { id: true, pipelineId: true, stage: { select: { kind: true } } },
  });
  if (!deal || deal.stage.kind === "WON") return { moved: false };
  const won = await db.crmStage.findFirst({
    where: { organizationId, pipelineId: deal.pipelineId, kind: "WON" },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });
  if (!won) return { moved: false, note: "Its pipeline has no won stage." };
  try {
    const r = await moveDeal(actor, deal.id, { stageId: won.id, closeReason: "Accepted the quote" }, { trusted: true, source: actor.userId ? "user" : "system" });
    if (r.needs) return { moved: false, note: `The won stage needs ${r.needs.labels.join(", ")} first.` };
    return { moved: true };
  } catch (error) {
    if (error instanceof CrmError) return { moved: false, note: error.message };
    throw error;
  }
}

// ---- The public page (/q/{token}) ---------------------------------------------------------

export interface PublicQuote {
  organizationId: string;
  kind: QuoteKind;
  number: string;
  title: string;
  status: QuoteStatus;
  currency: string;
  notes: string | null;
  validUntil: string | null;
  sentAt: string | null;
  acceptedName: string | null;
  acceptedAt: string | null;
  lines: LineInput[];
  taxBps: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  forName: string | null;
  canRespond: boolean;
}

/** The quote behind a token, as the recipient sees it (nothing internal), or null. */
export async function loadPublicQuote(token: string): Promise<PublicQuote | null> {
  const parsed = parsePublicToken(token);
  if (!parsed) return null;
  return withSystemOrgTx(parsed.orgId, async ({ db }) => {
    const q = await db.crmQuote.findFirst({
      where: { organizationId: parsed.orgId, publicTokenHash: hashQuoteToken(token) },
      include: { lines: { orderBy: { sortOrder: "asc" } } },
    });
    if (!q) return null;
    const status = effectiveStatus({ status: q.status, validUntil: q.validUntil });
    if (status === "EXPIRED" && q.status === "SENT") {
      await db.crmQuote.update({ where: { id: q.id }, data: { status: "EXPIRED" } });
    }
    const company = q.companyId
      ? await db.crmCompany.findFirst({ where: { id: q.companyId, organizationId: parsed.orgId }, select: { name: true } })
      : null;
    const person = q.personId
      ? await db.crmPerson.findFirst({ where: { id: q.personId, organizationId: parsed.orgId }, select: { name: true } })
      : null;
    const lines = q.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitCents: l.unitCents }));
    const totals = quoteTotals(lines, q.taxBps);
    const kind = q.kind === "invoice" ? "invoice" : "quote";
    return {
      organizationId: parsed.orgId,
      kind,
      number: q.number,
      title: q.title,
      status,
      currency: q.currency,
      notes: q.notes,
      validUntil: q.validUntil?.toISOString() ?? null,
      sentAt: q.sentAt?.toISOString() ?? null,
      acceptedName: q.acceptedName,
      acceptedAt: q.acceptedAt?.toISOString() ?? null,
      lines,
      taxBps: q.taxBps,
      ...totals,
      forName: [person?.name, company?.name].filter(Boolean).join(", ") || null,
      canRespond: kind === "quote" && canRespond({ status: q.status, validUntil: q.validUntil, kind }),
    };
  });
}

export function hashIp(organizationId: string, ip: string): string {
  return createHash("sha256").update(`${organizationId}|${ip}`).digest("hex");
}

/**
 * The recipient accepts (typed name) or declines, on the service path in
 * the token's organization. Returns words for the page.
 */
export async function respondToQuote(
  token: string,
  input: { accept: true; name: string; ip: string } | { accept: false; reason?: string | null },
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const parsed = parsePublicToken(token);
  if (!parsed) return { ok: false, error: "This link isn't valid." };
  return withSystemOrgTx(parsed.orgId, async ({ db }) => {
    const q = await db.crmQuote.findFirst({
      where: { organizationId: parsed.orgId, publicTokenHash: hashQuoteToken(token) },
    });
    if (!q) return { ok: false as const, error: "This link isn't valid any more." };
    const kind = q.kind === "invoice" ? "invoice" : "quote";
    if (!canRespond({ status: q.status, validUntil: q.validUntil, kind })) {
      return {
        ok: false as const,
        error:
          q.status === "ACCEPTED" || q.status === "PAID"
            ? "It's already accepted."
            : q.status === "DECLINED"
              ? "It was declined."
              : "This quote has expired. Ask for a new one.",
      };
    }
    if (input.accept) {
      const name = cleanSignature(input.name);
      if (!name) return { ok: false as const, error: "Type your full name to accept." };
      await db.crmQuote.update({
        where: { id: q.id },
        data: { status: "ACCEPTED", acceptedName: name, acceptedAt: new Date(), acceptedIpHash: hashIp(parsed.orgId, input.ip) },
      });
      await logQuote(db, parsed.orgId, q, "accepted", null, `Accepted by ${name}.`);
      const actor: CrmActor = { db, organizationId: parsed.orgId, userId: null as unknown as string, role: "MEMBER" as Role };
      const moved = await moveToWon(actor, q);
      if (moved.note) {
        await logActivity(db, {
          organizationId: parsed.orgId,
          kind: "SYSTEM",
          subject: `Couldn't move it to won: ${moved.note}`,
          targets: targetsOf(q),
          meta: { quoteId: q.id },
        });
      }
      return { ok: true as const, message: `Thanks, ${name}. It's accepted.` };
    }
    const reason = input.reason?.trim().slice(0, 1000) || null;
    await db.crmQuote.update({
      where: { id: q.id },
      data: { status: "DECLINED", declinedAt: new Date(), declineReason: reason },
    });
    await logQuote(db, parsed.orgId, q, "declined", null, reason ? `Declined: ${reason}` : "Declined.");
    return { ok: true as const, message: "Thanks for letting us know." };
  });
}

/** What the PDF needs, read in the caller's transaction (member or service path). */
export async function quoteForPdf(
  db: TxClient,
  organizationId: string,
  where: { id: string } | { publicTokenHash: string },
): Promise<import("./quote-pdf").QuotePdfInput | null> {
  const q = await db.crmQuote.findFirst({
    where: { organizationId, ...where },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  if (!q) return null;
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true, logo: true } });
  const theme = await db.orgTheme.findUnique({ where: { organizationId }, select: { light: true } });
  const primary = (theme?.light as { primary?: unknown } | null)?.primary;
  const company = q.companyId
    ? await db.crmCompany.findFirst({ where: { id: q.companyId, organizationId }, select: { name: true } })
    : null;
  const person = q.personId
    ? await db.crmPerson.findFirst({ where: { id: q.personId, organizationId }, select: { name: true } })
    : null;
  return {
    kind: q.kind === "invoice" ? "invoice" : "quote",
    number: q.number,
    title: q.title,
    status: q.status,
    orgName: org?.name ?? "",
    logo: org?.logo ?? null,
    color: typeof primary === "string" ? primary : null,
    forName: [person?.name, company?.name].filter(Boolean).join(", ") || null,
    currency: q.currency,
    notes: q.notes,
    validUntil: q.validUntil,
    sentAt: q.sentAt ?? q.createdAt,
    acceptedName: q.acceptedName,
    acceptedAt: q.acceptedAt,
    lines: q.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitCents: l.unitCents })),
    taxBps: q.taxBps,
  };
}
