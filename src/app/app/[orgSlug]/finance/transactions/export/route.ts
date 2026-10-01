import { NextResponse } from "next/server";

import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { can } from "@/lib/auth/permissions";
import { getSession } from "@/lib/auth/session";
import { csvContentDisposition, toCsv } from "@/lib/csv";
import { withOrgTx, withUserTx } from "@/server/db/context";

import { getTransactions, type TransactionFilters } from "../../queries";

/**
 * GET /app/{orgSlug}/finance/transactions/export: the filtered transaction
 * list as CSV, for OWNER/TREASURER. The slug resolves through
 * app.resolve_org_slug (a renamed org's old slug still works), and the rows
 * are read in a withOrgTx transaction as the caller: 401 without a session,
 * 404 for an unknown org or a non-member, 403 for a member without finance
 * access.
 */
export async function GET(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const orgId = await withUserTx(session.user.id, async ({ db }) => {
    const rows = await db.$queryRaw<{ organizationId: string }[]>`
      SELECT "organizationId" FROM app.resolve_org_slug(${orgSlug})`;
    return rows[0]?.organizationId ?? null;
  });
  if (!orgId) return new NextResponse("Not found", { status: 404 });

  const url = new URL(request.url);
  const q = url.searchParams;
  const filters: TransactionFilters = {
    budgetPeriodId: q.get("period") ?? undefined,
    categoryId: q.get("category") ?? undefined,
    kind: (q.get("kind") as TransactionFilters["kind"]) ?? undefined,
    status: (q.get("status") as TransactionFilters["status"]) ?? undefined,
    submittedById: q.get("submitter") ?? undefined,
    dateFrom: q.get("dateFrom") ?? undefined,
    dateTo: q.get("dateTo") ?? undefined,
    reconciled:
      q.get("reconciled") === "yes" || q.get("reconciled") === "no"
        ? (q.get("reconciled") as "yes" | "no")
        : undefined,
    deleted: q.get("deleted") === "show" ? "show" : undefined,
  };

  let transactions;
  try {
    transactions = await withOrgTx(orgId, async (ctx) => {
      if (!can(ctx, "finance.manage")) throw new ForbiddenError();
      return getTransactions(ctx.db, orgId, filters);
    });
  } catch (error) {
    if (error instanceof ForbiddenError) return new NextResponse("Forbidden", { status: 403 });
    if (error instanceof NotFoundError) return new NextResponse("Not found", { status: 404 });
    throw error;
  }

  const header = [
    "Date",
    "Description",
    "Kind",
    "Direction",
    "Category",
    "Submitted By",
    "Status",
    "Amount",
    "Voided",
  ];
  const rows = transactions.map((t) => [
    t.occurredAt.toISOString().slice(0, 10),
    t.description,
    t.kind,
    t.direction,
    t.category?.name ?? "",
    t.submittedBy.name ?? t.submittedBy.email,
    t.status,
    (t.amountCents / 100).toFixed(2),
    t.voidedAt ? "yes" : "no",
  ]);

  // Formula-safe (src/lib/csv.ts): descriptions, categories and names are
  // user input and must never be evaluated by a spreadsheet.
  const csv = toCsv(rows, { header, bom: true });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": csvContentDisposition("transactions.csv"),
      "Cache-Control": "private, no-store",
    },
  });
}
