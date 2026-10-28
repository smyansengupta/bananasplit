import "server-only";

import { z } from "zod";

import type { TransactionStatus } from "@/generated/prisma/client";
import { NotFoundError } from "@/lib/auth/errors";
import { formatCents } from "@/lib/finance/money";
import {
  getMyReimbursements,
  type TransactionWithRelations,
} from "@/app/app/[orgSlug]/finance/queries";

import { decodeCursor, listFingerprint, pageOf } from "./cursor";
import { itemId, type ItemRef } from "./ids";
import {
  cursorArg,
  limitArg,
  nextCursor,
  READ_ONLY,
  readResult,
  spaceArg,
  spaceRef,
  urlField,
  type ConnectorSession,
  type FetchedItem,
  type ToolRegistrar,
} from "./shared";
import { inSpace, type ToolSpace } from "./space";
import { dayOf, zonedIso } from "./text";

/**
 * list_my_reimbursements (docs/features/ai-connectors.md): the member's
 * own expense requests in a club, as My reimbursements lists them. Only
 * their own: the ledger is not exposed (RLS lets every member read it, and
 * the app gates it on finance.manage), and neither are receipts' files or
 * anyone's email.
 */

const FINANCE = { feature: "finance", section: "finance" } as const;

const STATUS_OUT: Record<TransactionStatus, string> = {
  DRAFT: "draft",
  SUBMITTED: "submitted",
  APPROVED: "approved",
  REIMBURSED: "reimbursed",
  REJECTED: "rejected",
  NOT_APPLICABLE: "not_applicable",
};

const expense = z.object({
  id: z.string().describe("The expense's id, for fetch."),
  description: z.string(),
  amount: z.string().describe('The amount as the app writes it ("$45.17").'),
  amountCents: z.number().int(),
  currency: z.string(),
  status: z.string().describe("draft, submitted, approved, reimbursed or rejected."),
  day: z.string().describe("The day the money was spent (yyyy-mm-dd)."),
  category: z.string().nullable(),
  submittedAt: z.string(),
  approvedAt: z.string().nullable(),
  reimbursedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  receipts: z.number().int().describe("How many receipts are attached."),
  voided: z.boolean(),
  url: urlField,
});

const listOutput = z.object({
  space: spaceRef,
  reimbursements: z.array(expense),
  total: z.number().int(),
  nextCursor,
});

type Expense = z.infer<typeof expense>;

function expenseOf(space: ToolSpace, t: TransactionWithRelations): Expense {
  return {
    id: itemId("expense", space.id, t.id),
    description: t.description,
    amount: formatCents(t.amountCents, t.currency),
    amountCents: t.amountCents,
    currency: t.currency,
    status: STATUS_OUT[t.status],
    day: dayOf(t.occurredAt),
    category: t.category?.name ?? null,
    submittedAt: zonedIso(t.createdAt, space.zone),
    approvedAt: t.approvedAt ? zonedIso(t.approvedAt, space.zone) : null,
    reimbursedAt: t.reimbursedAt ? zonedIso(t.reimbursedAt, space.zone) : null,
    rejectionReason: t.status === "REJECTED" ? t.rejectionReason : null,
    receipts: t.receipts.length,
    voided: t.voidedAt !== null,
    url: space.url("/finance/my-reimbursements"),
  };
}

const listInput = z.object({ space: spaceArg, limit: limitArg, cursor: cursorArg });

export async function listMyReimbursements(
  session: ConnectorSession,
  raw: z.input<typeof listInput>,
): Promise<z.infer<typeof listOutput>> {
  const args = listInput.parse(raw);
  const list = listFingerprint("list_my_reimbursements", { space: args.space });
  const position = decodeCursor(args.cursor, list);
  return inSpace(session, args.space, FINANCE, async (ctx, space) => {
    const mine = await getMyReimbursements(ctx.db, space.id, ctx.userId);
    const page = pageOf(
      mine.slice(position.offset, position.offset + args.limit + 1),
      args.limit,
      list,
      position,
    );
    return {
      space: { id: space.id, name: space.name },
      reimbursements: page.items.map((t) => expenseOf(space, t)),
      total: mine.length,
      nextCursor: page.nextCursor,
    };
  });
}

/** One of the member's own expenses for fetch; anyone else's is not found. */
export async function fetchExpense(session: ConnectorSession, ref: ItemRef): Promise<FetchedItem> {
  const { item, space } = await inSpace(session, ref.spaceId, FINANCE, async (ctx, space) => {
    const found = (await getMyReimbursements(ctx.db, space.id, ctx.userId)).find(
      (t) => t.id === ref.id,
    );
    if (!found) throw new NotFoundError();
    return { item: expenseOf(space, found), space };
  });
  const facts = [
    `Amount: ${item.amount}`,
    `Status: ${item.status}${item.voided ? " (voided)" : ""}`,
    `Spent on: ${item.day}`,
    item.category && `Category: ${item.category}`,
    item.approvedAt && `Approved: ${item.approvedAt}`,
    item.reimbursedAt && `Paid back: ${item.reimbursedAt}`,
    item.rejectionReason && `Why it was rejected: ${item.rejectionReason}`,
    `Receipts: ${item.receipts}`,
  ].filter(Boolean);
  return {
    id: item.id,
    title: item.description,
    text: [`# ${item.description}`, facts.join("\n")].join("\n\n"),
    url: item.url,
    metadata: {
      kind: "expense",
      spaceId: space.id,
      space: space.name,
      status: item.status,
      amountCents: item.amountCents,
    },
  };
}

export const registerFinanceTools: ToolRegistrar = (server, session) => {
  server.registerTool(
    "list_my_reimbursements",
    {
      title: "List my reimbursements",
      description:
        "Lists the member's own expense requests in an organization, newest first: the amount, what it was for, its status (submitted, approved, reimbursed, rejected) and when it was paid back.",
      inputSchema: listInput,
      outputSchema: listOutput,
      annotations: READ_ONLY,
    },
    (args) => readResult("list_my_reimbursements", () => listMyReimbursements(session, args)),
  );
};
