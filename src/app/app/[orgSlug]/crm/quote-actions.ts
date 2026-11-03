"use server";

import type { QuoteKind } from "@/lib/crm/quotes";
import {
  createQuote,
  duplicateQuote,
  markPaid,
  moveQuote,
  moveToWon,
  saveQuote,
  sendQuote,
  type QuoteDraftInput,
  type QuoteSaveInput,
} from "@/server/crm/quotes";
import { CrmError } from "@/server/crm/access";

import { crmAction } from "./run";

/** Quotes and invoices (src/server/crm/quotes.ts), each in one member transaction. */

export const createQuoteAction = crmAction(async (ctx, _a, input: QuoteDraftInput) => createQuote(ctx, input));

export const saveQuoteAction = crmAction(async (ctx, _a, id: string, input: QuoteSaveInput) => saveQuote(ctx, id, input));

export const sendQuoteAction = crmAction(async (ctx, _a, id: string) => {
  const { token } = await sendQuote(ctx, id);
  return { path: `/q/${token}` };
});

export const duplicateQuoteAction = crmAction(
  async (ctx, _a, id: string, input: { dealId?: string | null; kind?: QuoteKind }) => duplicateQuote(ctx, id, input),
);

export const moveQuoteAction = crmAction(async (ctx, _a, id: string, dealId: string) => {
  await moveQuote(ctx, id, dealId);
  return {};
});

export const markPaidAction = crmAction(async (ctx, _a, id: string, book: boolean) => markPaid(ctx, id, { book }));

export const moveToWonAction = crmAction(async (ctx, _a, id: string) => {
  const q = await ctx.db.crmQuote.findFirst({ where: { id, organizationId: ctx.organizationId }, select: { dealId: true, status: true } });
  if (!q) throw new CrmError("That quote isn't here any more.");
  if (q.status !== "ACCEPTED" && q.status !== "PAID") throw new CrmError("Only an accepted quote moves its item to won.");
  const r = await moveToWon(ctx, q);
  if (r.note) throw new CrmError(r.note);
  return { moved: r.moved };
});
