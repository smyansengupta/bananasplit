import { NextResponse } from "next/server";

import { requireFinanceAccess } from "@/lib/auth/guards";
import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { csvContentDisposition, toCsv } from "@/lib/csv";
import { prisma } from "@/lib/prisma";

import { getTransactions, type TransactionFilters } from "../../queries";

export async function GET(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return new NextResponse("Not found", { status: 404 });

  try {
    await requireFinanceAccess(org.id);
  } catch (error) {
    if (error instanceof ForbiddenError) return new NextResponse("Forbidden", { status: 403 });
    if (error instanceof NotFoundError) return new NextResponse("Not found", { status: 404 });
    return new NextResponse("Unauthorized", { status: 401 });
  }

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
  };

  const transactions = await getTransactions(org.id, filters);

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
