import Link from "next/link";

import { CrmTabs } from "@/components/crm/crm-tabs";
import { QuotesBar } from "@/components/crm/quotes/quotes-bar";
import { EmptyState } from "@/components/empty-state";
import { ReceiptText } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { Prisma } from "@/generated/prisma/client";
import { formatMoney } from "@/lib/crm/fields";
import { effectiveStatus, KIND_WORD, STATUS_WORD, type QuoteKind, type QuoteStatus } from "@/lib/crm/quotes";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../shell";

export const metadata = { title: "Quotes" };

const STATES: Record<string, Prisma.CrmQuoteWhereInput> = {
  open: { status: { in: ["DRAFT", "SENT"] } },
  accepted: { status: "ACCEPTED" },
  paid: { status: "PAID" },
  closed: { status: { in: ["DECLINED", "EXPIRED"] } },
};

const variant = (s: QuoteStatus) =>
  s === "ACCEPTED" || s === "PAID" ? "success" : s === "DECLINED" || s === "EXPIRED" ? "outline" : s === "SENT" ? "info" : "secondary";

/** Quotes and invoices across the CRM, with who they're for and where they stand. */
export default async function CrmQuotesPage({ params, searchParams }: PageProps<"/app/[orgSlug]/crm/quotes">) {
  const { orgSlug } = await params;
  const sp = (await searchParams) as Record<string, string | undefined>;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const orgId = shell.org.id;
  const state = sp.status && STATES[sp.status] ? sp.status : "open";
  const kind = sp.kind === "quote" || sp.kind === "invoice" ? sp.kind : undefined;
  const q = sp.q?.trim().slice(0, 80);
  const data = await withOrgTx(orgId, async ({ db }) => {
    const base: Prisma.CrmQuoteWhereInput = {
      organizationId: orgId,
      ...(kind ? { kind } : {}),
      ...(q
        ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { title: { contains: q, mode: "insensitive" } }] }
        : {}),
    };
    const counts: Record<string, number> = {};
    for (const [k, where] of Object.entries(STATES)) counts[k] = await db.crmQuote.count({ where: { ...base, ...where } });
    const rows = await db.crmQuote.findMany({
      where: { ...base, ...STATES[state] },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        kind: true,
        number: true,
        title: true,
        status: true,
        totalCents: true,
        currency: true,
        validUntil: true,
        createdAt: true,
        deal: { select: { id: true, title: true } },
        company: { select: { id: true, name: true } },
      },
    });
    return { counts, rows };
  });
  return (
    <div className="space-y-6">
      <PageHeader title="Quotes" tabs={<CrmTabs tabs={shell.tabs} />} />
      <QuotesBar orgId={orgId} orgSlug={orgSlug} counts={data.counts} />
      {data.rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={ReceiptText}
            title={q ? "Nothing matches" : "No quotes here"}
            description="Make one from an item, a company or a person, or with New."
          />
        </Card>
      ) : (
        <Card className="gap-0 p-0">
          <ul className="divide-border divide-y">
            {data.rows.map((r) => {
              const s = effectiveStatus({ status: r.status, validUntil: r.validUntil });
              return (
                <li key={r.id}>
                  <Link
                    href={`/app/${orgSlug}/crm/quotes/${r.id}`}
                    className="hover:bg-muted/60 flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm"
                  >
                    <span className="text-muted-foreground w-20 shrink-0 tabular-nums">{r.number}</span>
                    <span className="min-w-0 flex-1">
                      <b className="block truncate">{r.title}</b>
                      <span className="text-muted-foreground block truncate text-xs">
                        {[KIND_WORD[r.kind as QuoteKind]?.title, r.deal?.title, r.company?.name].filter(Boolean).join(", ")}
                      </span>
                    </span>
                    <Badge variant={variant(s)}>{STATUS_WORD[s]}</Badge>
                    <span className="w-24 text-right font-semibold tabular-nums">{formatMoney(r.totalCents, r.currency)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
