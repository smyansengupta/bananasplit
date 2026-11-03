"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  duplicateQuoteAction,
  markPaidAction,
  moveQuoteAction,
  moveToWonAction,
  saveQuoteAction,
  sendQuoteAction,
} from "@/app/app/[orgSlug]/crm/quote-actions";
import { Copy, Download, Plus, Send, Trophy, X } from "@/components/icons";
import { CrmPicker } from "@/components/crm/crm-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { formatMoney } from "@/lib/crm/fields";
import { crmRecordHref } from "@/lib/crm/href";
import { KIND_WORD, parseCents, parseTaxBps, quoteTotals, STATUS_WORD, type QuoteKind, type QuoteStatus } from "@/lib/crm/quotes";

/**
 * A quote or invoice: who it's for, its lines and totals, and what can
 * happen next (send the link, download the PDF, copy it, make an invoice,
 * move it to another item, mark it paid, move the item to won). Accepted
 * and paid ones are read-only: copy one to change it.
 */

export interface QuoteView {
  id: string;
  kind: QuoteKind;
  number: string;
  title: string;
  status: QuoteStatus;
  currency: string;
  notes: string | null;
  validUntil: string | null;
  taxBps: number;
  lines: { description: string; quantity: number; unitCents: number }[];
  deal: { id: string; title: string; won: boolean } | null;
  company: { id: string; name: string } | null;
  person: { id: string; name: string; email: string | null } | null;
  sentAt: string | null;
  acceptedName: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  paidAt: string | null;
  booked: boolean;
}

interface Row {
  key: number;
  description: string;
  quantity: string;
  price: string;
}

const dollars = (cents: number) => (cents / 100).toFixed(2).replace(/\.00$/, "");

const variant = (s: QuoteStatus) =>
  s === "ACCEPTED" || s === "PAID" ? "success" : s === "DECLINED" || s === "EXPIRED" ? "outline" : s === "SENT" ? "info" : "secondary";

export function QuoteEditor({
  orgId,
  orgSlug,
  quote,
  canBook,
}: {
  orgId: string;
  orgSlug: string;
  quote: QuoteView;
  /** A finance role, with Finance added: may book the income. */
  canBook: boolean;
}) {
  const router = useRouter();
  const locked = quote.status === "ACCEPTED" || quote.status === "PAID";
  const word = KIND_WORD[quote.kind];
  const [title, setTitle] = useState(quote.title);
  const [validUntil, setValidUntil] = useState(quote.validUntil?.slice(0, 10) ?? "");
  const [currency, setCurrency] = useState(quote.currency);
  const [tax, setTax] = useState(quote.taxBps ? String(quote.taxBps / 100) : "");
  const [notes, setNotes] = useState(quote.notes ?? "");
  const [seq, setSeq] = useState(quote.lines.length + 1);
  const [rows, setRows] = useState<Row[]>(
    quote.lines.length
      ? quote.lines.map((l, i) => ({ key: i, description: l.description, quantity: String(l.quantity), price: dollars(l.unitCents) }))
      : [{ key: 0, description: "", quantity: "1", price: "" }],
  );
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [paidOpen, setPaidOpen] = useState(false);
  const [book, setBook] = useState(canBook);

  const parsed = useMemo(
    () =>
      rows.map((r) => ({
        description: r.description,
        quantity: Number(r.quantity || "0"),
        unitCents: parseCents(r.price || "0") ?? NaN,
      })),
    [rows],
  );
  const taxBps = parseTaxBps(tax);
  const totals = quoteTotals(
    parsed.filter((l) => Number.isFinite(l.unitCents) && Number.isInteger(l.quantity)),
    taxBps ?? 0,
  );

  function change<T>(set: (v: T) => void) {
    return (v: T) => {
      set(v);
      setDirty(true);
    };
  }

  async function run<T extends { ok: boolean }>(fn: () => Promise<T>, ok?: (r: T) => void) {
    setPending(true);
    const r = await fn().catch(() => null);
    setPending(false);
    if (!r || !r.ok) {
      toast({ title: r && "error" in r ? String((r as { error?: string }).error) : "That didn't work.", tone: "error" });
      return false;
    }
    ok?.(r);
    router.refresh();
    return true;
  }

  async function save(): Promise<boolean> {
    if (taxBps === null) {
      toast({ title: "Tax is a percent from 0 to 100.", tone: "error" });
      return false;
    }
    if (parsed.some((l) => (l.description.trim() || rows.some((r) => r.price)) && !Number.isFinite(l.unitCents))) {
      toast({ title: "Check the prices: numbers like 1250 or 12.50.", tone: "error" });
      return false;
    }
    return run(
      () =>
        saveQuoteAction(orgId, quote.id, {
          title,
          notes,
          currency,
          validUntil: validUntil || null,
          taxBps,
          lines: parsed.filter((l) => l.description.trim() || l.unitCents),
        }),
      () => {
        setDirty(false);
        toast({ title: quote.status === "SENT" ? "Saved. It's a draft again: send it for a new link." : "Saved." });
      },
    );
  }

  const party = quote.deal ?? quote.company ?? quote.person;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={variant(quote.status)}>{STATUS_WORD[quote.status]}</Badge>
        {party && (
          <span className="text-muted-foreground text-sm">
            For{" "}
            {quote.deal ? (
              <Link className="hover:text-foreground underline-offset-2 hover:underline" href={crmRecordHref(orgSlug, "deal", quote.deal.id)}>
                {quote.deal.title}
              </Link>
            ) : quote.company ? (
              <Link className="hover:text-foreground underline-offset-2 hover:underline" href={crmRecordHref(orgSlug, "company", quote.company.id)}>
                {quote.company.name}
              </Link>
            ) : quote.person ? (
              <Link className="hover:text-foreground underline-offset-2 hover:underline" href={crmRecordHref(orgSlug, "person", quote.person.id)}>
                {quote.person.name}
              </Link>
            ) : null}
          </span>
        )}
        <div className="ms-auto flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={`/app/${orgSlug}/crm/quotes/${quote.id}/pdf`} target="_blank" rel="noopener">
              <Download className="size-4" aria-hidden="true" />
              PDF
            </a>
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              void run(
                () => duplicateQuoteAction(orgId, quote.id, {}),
                (r) => router.push(`/app/${orgSlug}/crm/quotes/${(r as unknown as { id: string }).id}`),
              )
            }
          >
            <Copy className="size-4" aria-hidden="true" />
            Copy
          </Button>
          {quote.kind === "quote" && (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                void run(
                  () => duplicateQuoteAction(orgId, quote.id, { kind: "invoice" }),
                  (r) => router.push(`/app/${orgSlug}/crm/quotes/${(r as unknown as { id: string }).id}`),
                )
              }
            >
              Make an invoice
            </Button>
          )}
          <Button variant="outline" size="sm" disabled={pending} onClick={() => setMoveOpen(true)}>
            Move to another item
          </Button>
        </div>
      </div>

      {quote.acceptedName && quote.acceptedAt && (
        <p className="bg-tint-success text-tint-success-foreground rounded-tile p-3 text-sm">
          Accepted by {quote.acceptedName} on {new Date(quote.acceptedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.
        </p>
      )}
      {quote.declinedAt && (
        <p className="bg-muted rounded-tile p-3 text-sm">
          Declined{quote.declineReason ? `: ${quote.declineReason}` : "."}
        </p>
      )}

      <section className="bg-card ring-foreground/6 rounded-card space-y-4 p-5 ring-1">
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem_6rem_6rem]">
          <div className="grid gap-1.5">
            <Label htmlFor="q-title">Title</Label>
            <Input id="q-title" value={title} disabled={locked} onChange={(e) => change(setTitle)(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="q-valid">{quote.kind === "invoice" ? "Due" : "Valid until"}</Label>
            <Input id="q-valid" type="date" value={validUntil} disabled={locked} onChange={(e) => change(setValidUntil)(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="q-currency">Currency</Label>
            <Input id="q-currency" value={currency} maxLength={3} disabled={locked} onChange={(e) => change(setCurrency)(e.target.value.toUpperCase())} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="q-tax">Tax %</Label>
            <Input id="q-tax" inputMode="decimal" value={tax} placeholder="0" disabled={locked} onChange={(e) => change(setTax)(e.target.value)} />
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-muted-foreground hidden grid-cols-[1fr_5rem_8rem_7rem_2rem] gap-2 text-xs font-semibold sm:grid">
            <span>Description</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Price</span>
            <span className="text-right">Amount</span>
            <span />
          </div>
          {rows.map((r, i) => {
            const l = parsed[i]!;
            return (
              <div key={r.key} className="grid grid-cols-[1fr_5rem_8rem_7rem_2rem] items-center gap-2">
                <Input
                  aria-label="Description"
                  value={r.description}
                  disabled={locked}
                  placeholder="What it's for"
                  onChange={(e) => change(setRows)(rows.map((x) => (x.key === r.key ? { ...x, description: e.target.value } : x)))}
                />
                <Input
                  aria-label="Quantity"
                  inputMode="numeric"
                  className="text-right"
                  value={r.quantity}
                  disabled={locked}
                  onChange={(e) => change(setRows)(rows.map((x) => (x.key === r.key ? { ...x, quantity: e.target.value.replace(/\D/g, "") } : x)))}
                />
                <Input
                  aria-label="Price"
                  inputMode="decimal"
                  className="text-right"
                  value={r.price}
                  disabled={locked}
                  placeholder="0"
                  onChange={(e) => change(setRows)(rows.map((x) => (x.key === r.key ? { ...x, price: e.target.value } : x)))}
                />
                <span className="text-right text-sm tabular-nums">
                  {Number.isFinite(l.unitCents) ? formatMoney(l.quantity * l.unitCents, currency || "USD") : ""}
                </span>
                {!locked ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove line"
                    onClick={() => change(setRows)(rows.filter((x) => x.key !== r.key))}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </Button>
                ) : (
                  <span />
                )}
              </div>
            );
          })}
          {!locked && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setRows([...rows, { key: seq, description: "", quantity: "1", price: "" }]);
                setSeq(seq + 1);
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              Line
            </Button>
          )}
        </div>

        <dl className="ms-auto w-full max-w-64 space-y-1 text-sm">
          {(taxBps ?? 0) > 0 && (
            <>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="tabular-nums">{formatMoney(totals.subtotalCents, currency || "USD")}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Tax</dt>
                <dd className="tabular-nums">{formatMoney(totals.taxCents, currency || "USD")}</dd>
              </div>
            </>
          )}
          <div className="flex justify-between border-t pt-1.5 text-base font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatMoney(totals.totalCents, currency || "USD")}</dd>
          </div>
        </dl>

        <div className="grid gap-1.5">
          <Label htmlFor="q-notes">Notes</Label>
          <Textarea id="q-notes" rows={3} value={notes} disabled={locked} placeholder="Terms, what's included, how to pay" onChange={(e) => change(setNotes)(e.target.value)} />
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {quote.status === "ACCEPTED" && quote.deal && !quote.deal.won && (
          <Button variant="outline" disabled={pending} onClick={() => void run(() => moveToWonAction(orgId, quote.id), () => toast({ title: "Moved to won." }))}>
            <Trophy className="size-4" aria-hidden="true" />
            Move the item to won
          </Button>
        )}
        {(quote.status === "SENT" || quote.status === "ACCEPTED" || quote.status === "EXPIRED") && (
          <Button variant="outline" disabled={pending} onClick={() => setPaidOpen(true)}>
            Mark paid
          </Button>
        )}
        {!locked && (
          <Button variant="outline" disabled={pending || !dirty} onClick={() => void save()}>
            {pending ? "Saving…" : "Save"}
          </Button>
        )}
        {!locked && (
          <Button
            disabled={pending}
            onClick={async () => {
              if (dirty && !(await save())) return;
              await run(
                () => sendQuoteAction(orgId, quote.id),
                (r) => setLink(`${window.location.origin}${(r as unknown as { path: string }).path}`),
              );
            }}
          >
            <Send className="size-4" aria-hidden="true" />
            {quote.status === "SENT" ? "New link" : "Send"}
          </Button>
        )}
      </div>

      <Dialog open={Boolean(link)} onOpenChange={(o) => !o && setLink(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{word.title} {quote.number} is ready</DialogTitle>
            <DialogDescription>
              Send this link. They can read it, download the PDF and {quote.kind === "quote" ? "accept it by typing their name" : "see what's due"}.
              It&apos;s shown once; sending again makes a new one.
            </DialogDescription>
          </DialogHeader>
          <code className="bg-muted block rounded-md p-2 text-[12.5px] break-all">{link}</code>
          <DialogFooter>
            {quote.person?.email && link && (
              <Button asChild variant="outline">
                <a href={`mailto:${quote.person.email}?subject=${encodeURIComponent(`${word.title} ${quote.number}: ${title}`)}&body=${encodeURIComponent(link)}`}>Email it</a>
              </Button>
            )}
            <Button
              onClick={() => {
                if (link) void navigator.clipboard?.writeText(link).then(() => toast({ title: "Copied." }));
              }}
            >
              <Copy className="size-4" aria-hidden="true" />
              Copy link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move {quote.number} to another item</DialogTitle>
            <DialogDescription>It moves with its lines and its link. The item&apos;s company and person come with it.</DialogDescription>
          </DialogHeader>
          <CrmPicker
            orgId={orgId}
            kind="deal"
            value={null}
            autoOpen
            allowClear={false}
            placeholder="Search items"
            onPick={(hit) => {
              if (!hit) return;
              void run(
                () => moveQuoteAction(orgId, quote.id, hit.id),
                () => {
                  setMoveOpen(false);
                  toast({ title: `Moved to ${hit.label}.` });
                },
              );
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={paidOpen} onOpenChange={setPaidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark {quote.number} paid?</DialogTitle>
            <DialogDescription>{formatMoney(quote.lines.length ? totals.totalCents : 0, quote.currency)} received.</DialogDescription>
          </DialogHeader>
          {canBook && (
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>
                Book it in Finance
                <span className="text-muted-foreground block text-xs">As income in the active budget period.</span>
              </span>
              <Switch checked={book} onCheckedChange={setBook} />
            </label>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPaidOpen(false)}>
              Not yet
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                void run(
                  () => markPaidAction(orgId, quote.id, canBook && book),
                  (r) => {
                    setPaidOpen(false);
                    toast({ title: (r as unknown as { booked: boolean }).booked ? "Paid, and booked in Finance." : "Marked paid." });
                  },
                )
              }
            >
              Mark paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
