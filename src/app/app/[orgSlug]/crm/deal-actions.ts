"use server";

import { appOrigin } from "@/lib/app-url";
import { DEAL_TYPE_FIELD, DEAL_TYPES, dealTypeField } from "@/lib/crm/deals-tab";
import { formatMoney } from "@/lib/crm/fields";
import { choiceId } from "@/lib/databases/fields";
import { KIND_WORD, type QuoteKind } from "@/lib/crm/quotes";
import { CrmError } from "@/server/crm/access";
import { addCrmField, customFieldsFor } from "@/server/crm/databases";
import { updateDeal } from "@/server/crm/deals";
import { cancelEmail, composeEmail } from "@/server/crm/outreach/send";
import { createQuote, duplicateQuote, saveQuote, sendQuote } from "@/server/crm/quotes";

import { crmAction } from "./run";

/**
 * The deal card's actions (docs/features/crm.md, "Redesign"): its type,
 * pushing its next step, and its quote and invoice: make one from the deal,
 * send it in a tracked email that waits ten seconds (Undo takes the email
 * back and returns the quote to a draft), and draft the invoice once it's
 * won. Each runs in one member transaction (RLS decides).
 */

const HOLD_MS = 12_000;

/** Sets a deal's type (null clears it); the first pick adds the Type field to its pipeline. */
export const setDealTypeAction = crmAction(async (ctx, access, dealId: string, label: string | null) => {
  const deal = await ctx.db.crmDeal.findFirst({
    where: { id: dealId, organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true, pipelineId: true, custom: true },
  });
  if (!deal) throw new CrmError("That deal isn't in the CRM any more.");
  let field = dealTypeField(await customFieldsFor(ctx.db, ctx.organizationId, "deal", deal.pipelineId));
  if (!field) {
    if (label === null) return {};
    if (!access.manager) throw new CrmError("Ask a CRM manager to add types to this pipeline.");
    field = await addCrmField(
      ctx,
      { object: "deal", pipelineId: deal.pipelineId },
      {
        name: DEAL_TYPE_FIELD,
        type: "SELECT",
        options: { choices: DEAL_TYPES.map((t) => ({ id: choiceId(), label: t.label, color: t.color })) },
      },
    );
  }
  const choice = label ? field.options.choices?.find((c) => c.label.toLowerCase() === label.toLowerCase()) : null;
  if (label && !choice) throw new CrmError("Pick one of the types.");
  await updateDeal(ctx, deal.id, { custom: { [field.id]: choice?.id ?? null } });
  return {};
});

/** Moves the next step's date on by `days` (from today when it's late); answers what it was. */
export const pushDealStepAction = crmAction(async (ctx, _a, dealId: string, days: number) => {
  const deal = await ctx.db.crmDeal.findFirst({
    where: { id: dealId, organizationId: ctx.organizationId },
    select: { nextStepAt: true },
  });
  if (!deal) throw new CrmError("That deal isn't in the CRM any more.");
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const from = deal.nextStepAt && deal.nextStepAt > today ? deal.nextStepAt : today;
  const next = new Date(from.getTime() + Math.max(1, Math.min(60, Math.round(days))) * 86_400_000);
  await updateDeal(ctx, dealId, { nextStepAt: next.toISOString().slice(0, 10) });
  return { before: deal.nextStepAt?.toISOString().slice(0, 10) ?? null };
});

/** Puts the next step's date back (Undo after Push). */
export const setDealStepAtAction = crmAction(async (ctx, _a, dealId: string, at: string | null) => {
  await updateDeal(ctx, dealId, { nextStepAt: at });
  return {};
});

/** A draft quote (or invoice) filled from the deal: its amount as the first line. */
export const makeDealQuoteAction = crmAction(async (ctx, _a, dealId: string, kind: QuoteKind = "quote") => {
  if (kind === "invoice") {
    // From the quote they agreed to, when there is one.
    const agreed = await ctx.db.crmQuote.findFirst({
      where: { organizationId: ctx.organizationId, dealId, kind: "quote", status: { in: ["ACCEPTED", "PAID", "SENT"] } },
      orderBy: [{ acceptedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      select: { id: true },
    });
    if (agreed) return duplicateQuote(ctx, agreed.id, { kind: "invoice" });
  }
  return createQuote(ctx, { dealId, kind });
});

/**
 * Sends a quote or invoice: makes its link and queues a tracked email to
 * the person it's for, ten seconds out, so Undo can still take it back.
 */
export const sendDealQuoteAction = crmAction(async (ctx, _a, quoteId: string) => {
  const q = await ctx.db.crmQuote.findFirst({
    where: { id: quoteId, organizationId: ctx.organizationId },
    select: { id: true, kind: true, number: true, title: true, totalCents: true, currency: true, personId: true, dealId: true },
  });
  if (!q) throw new CrmError("That quote isn't here any more.");
  const person = q.personId
    ? await ctx.db.crmPerson.findFirst({
        where: { id: q.personId, organizationId: ctx.organizationId, deletedAt: null },
        select: { id: true, name: true, primaryEmail: true },
      })
    : null;
  if (!person?.primaryEmail) throw new CrmError("Add a contact with an email to the deal first.");
  const { token } = await sendQuote(ctx, q.id);
  const word = KIND_WORD[(q.kind as QuoteKind) ?? "quote"] ?? KIND_WORD.quote;
  const link = `${appOrigin()}/q/${token}`;
  const r = await composeEmail(ctx, {
    personId: person.id,
    dealId: q.dealId,
    subject: `${word.title} ${q.number}: ${q.title}`,
    body:
      q.kind === "invoice"
        ? `Hi {{first_name|there}},\n\nHere's invoice ${q.number} for ${formatMoney(q.totalCents, q.currency)}: ${link}\n\nThank you!\n{{my_first_name}}`
        : `Hi {{first_name|there}},\n\nHere's the quote for ${q.title}, ${formatMoney(q.totalCents, q.currency)} in all. You can read it and accept it here: ${link}\n\n{{my_first_name}}`,
    sendAt: new Date(Date.now() + HOLD_MS).toISOString(),
    confirmConflict: true,
    track: true,
  });
  if ("conflict" in r) throw new CrmError("Someone else is writing to them right now. Try again in a minute.");
  return { messageId: r.messageId, to: person.name };
});

/** Undo a send: the email doesn't go and the quote is a draft again (its link stops working). */
export const unsendDealQuoteAction = crmAction(async (ctx, _a, quoteId: string, messageId: string) => {
  await cancelEmail(ctx, messageId);
  await saveQuote(ctx, quoteId, {});
  return {};
});

/** Saves a quote's lines from the deal card (a sent one goes back to a draft). */
export const saveDealQuoteLinesAction = crmAction(
  async (ctx, _a, quoteId: string, lines: { description: string; quantity: number; unitCents: number }[]) =>
    saveQuote(ctx, quoteId, { lines }),
);
