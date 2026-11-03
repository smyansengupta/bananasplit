import { FileQuestion } from "@/components/icons";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/crm/fields";
import { KIND_WORD, lineCents, STATUS_WORD } from "@/lib/crm/quotes";

import { publicQuote } from "./load";
import { RespondToQuote } from "./respond";

export const dynamic = "force-dynamic";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * A quote or invoice sent from the CRM (/q/{token}): what it's for, the
 * lines and total, the PDF, and on a quote, Accept by typing a name or
 * Decline. No account needed; the link is the credential.
 */
export default async function PublicQuotePage({ params }: PageProps<"/q/[token]">) {
  const { token } = await params;
  const found = await publicQuote(token);
  if (!found) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">
        <EmptyState
          icon={FileQuestion}
          title="This link doesn't work"
          description="It may have been replaced by a newer one. Ask whoever sent it for the latest link."
        />
      </main>
    );
  }
  const { quote: q } = found;
  const word = KIND_WORD[q.kind];
  const money = (c: number) => formatMoney(c, q.currency);
  const raw = decodeURIComponent(token);
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-4 py-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={q.status === "ACCEPTED" || q.status === "PAID" ? "success" : q.status === "SENT" ? "info" : "outline"}>
            {STATUS_WORD[q.status]}
          </Badge>
          <span className="text-muted-foreground text-sm">
            {word.title} {q.number}
          </span>
        </div>
        <h1 className="page-title">{q.title}</h1>
        <p className="text-muted-foreground text-sm">
          {[
            q.forName ? `For ${q.forName}` : null,
            q.sentAt ? `Sent ${day(q.sentAt)}` : null,
            q.validUntil ? `${q.kind === "invoice" ? "Due" : "Valid until"} ${day(q.validUntil)}` : null,
          ]
            .filter(Boolean)
            .join(". ")}
        </p>
      </header>

      <section className="bg-card ring-foreground/6 rounded-card p-5 ring-1">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground border-b text-left text-xs">
              <th className="pb-2 font-semibold">Description</th>
              <th className="pb-2 text-right font-semibold">Qty</th>
              <th className="pb-2 text-right font-semibold">Price</th>
              <th className="pb-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {q.lines.map((l, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="py-2 pr-3">{l.description}</td>
                <td className="py-2 text-right tabular-nums">{l.quantity}</td>
                <td className="py-2 text-right tabular-nums">{money(l.unitCents)}</td>
                <td className="py-2 text-right tabular-nums">{money(lineCents(l))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="ms-auto mt-4 w-full max-w-64 space-y-1 text-sm">
          {q.taxBps > 0 && (
            <>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="tabular-nums">{money(q.subtotalCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Tax</dt>
                <dd className="tabular-nums">{money(q.taxCents)}</dd>
              </div>
            </>
          )}
          <div className="flex justify-between border-t pt-1.5 text-base font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{money(q.totalCents)}</dd>
          </div>
        </dl>
        {q.notes && <p className="text-muted-foreground mt-5 text-sm whitespace-pre-wrap">{q.notes}</p>}
      </section>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <a href={`/q/${encodeURIComponent(raw)}/pdf`}>Download the PDF</a>
        </Button>
      </div>

      {q.status === "ACCEPTED" || q.status === "PAID" ? (
        q.acceptedName && q.acceptedAt ? (
          <p className="bg-tint-success text-tint-success-foreground rounded-tile p-4 text-sm">
            Accepted by {q.acceptedName} on {day(q.acceptedAt)}.
          </p>
        ) : null
      ) : q.canRespond ? (
        <section className="bg-card ring-foreground/6 rounded-card p-5 ring-1">
          <RespondToQuote token={raw} total={money(q.totalCents)} />
        </section>
      ) : q.status === "EXPIRED" ? (
        <p className="bg-muted rounded-tile p-4 text-sm">This quote has expired. Ask for a new one.</p>
      ) : q.status === "DECLINED" ? (
        <p className="bg-muted rounded-tile p-4 text-sm">This quote was declined.</p>
      ) : null}
    </main>
  );
}
