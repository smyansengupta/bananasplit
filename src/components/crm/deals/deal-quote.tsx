"use client";

import { Download, Plus, X } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  saveDealQuoteLinesAction,
  sendDealQuoteAction,
  unsendDealQuoteAction,
} from "@/app/app/[orgSlug]/crm/deal-actions";
import { AMBIENT_BUTTON, AmbientButton, AmbientWhy } from "@/components/ambient/ambient-button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { formatMoney } from "@/lib/crm/fields";
import { KIND_WORD, parseCents, quoteTotals, STATUS_WORD, type QuoteKind, type QuoteStatus } from "@/lib/crm/quotes";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

/**
 * A deal's quote or invoice on its card's Quote tab: the lines (change a
 * description or a price in place), the total, and Send the quote. A send
 * waits ten seconds with Undo (the email doesn't go and the quote is a
 * draft again); after that it's out, tracked, and the line says so.
 */

export interface DealQuoteView {
  id: string;
  kind: QuoteKind;
  number: string;
  title: string;
  status: QuoteStatus;
  currency: string;
  taxBps: number;
  totalCents: number;
  lines: { description: string; quantity: number; unitCents: number }[];
  to: { name: string; email: string | null } | null;
  sentAt: string | null;
  acceptedName: string | null;
  paidAt: string | null;
}

const HOLD_MS = 10_000;
const OUTLINE =
  "text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,currentColor_28%,transparent)] hover:bg-muted";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Send with a ten-second Undo, for a quote or an invoice, wherever it's offered. */
export function useQuoteSend(orgId: string, quote: DealQuoteView | null) {
  const router = useRouter();
  const [held, setHeld] = useState<{ messageId: string; to: string } | null>(null);
  const [out, setOut] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const send = async (before?: () => Promise<boolean>) => {
    if (!quote) return {};
    if (before && !(await before())) return {};
    const r = await sendDealQuoteAction(orgId, quote.id);
    if (!r.ok) return r;
    setHeld({ messageId: r.messageId, to: r.to });
    timer.current = setTimeout(() => {
      setHeld(null);
      setOut(r.to);
      router.refresh();
    }, HOLD_MS);
    return {};
  };
  const undo = async () => {
    if (!quote || !held) return;
    if (timer.current) clearTimeout(timer.current);
    const r = await runAction(() => unsendDealQuoteAction(orgId, quote.id, held.messageId));
    if (r && !r.ok) toast({ title: r.error, tone: "error" });
    setHeld(null);
    router.refresh();
  };
  return { send, undo, held, out };
}

/** The line with Undo while a send is held, or once it's gone. */
export function SentLine({
  kind,
  held,
  out,
  onUndo,
}: {
  kind: QuoteKind;
  held: { to: string } | null;
  out: string | null;
  onUndo: () => void;
}) {
  if (held) {
    return (
      <div className="flex flex-nowrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm">
          Sent to {held.to}. It goes out in 10 seconds.
        </span>
        <button type="button" className={cn(AMBIENT_BUTTON, OUTLINE)} onClick={onUndo}>
          Undo
        </button>
      </div>
    );
  }
  if (out) {
    return (
      <p className="text-muted-foreground text-sm">
        Sent to {out}. You&apos;ll see it here when they open the {KIND_WORD[kind].one}.
      </p>
    );
  }
  return null;
}

interface Row {
  key: number;
  description: string;
  quantity: string;
  price: string;
}

const dollars = (cents: number) => (cents / 100).toFixed(2).replace(/\.00$/, "");

export function QuoteBlock({
  orgId,
  orgSlug,
  quote,
}: {
  orgId: string;
  orgSlug: string;
  quote: DealQuoteView;
}) {
  const router = useRouter();
  const locked = quote.status === "ACCEPTED" || quote.status === "PAID";
  const word = KIND_WORD[quote.kind];
  const [rows, setRows] = useState<Row[]>(
    quote.lines.length
      ? quote.lines.map((l, i) => ({
          key: i,
          description: l.description,
          quantity: String(l.quantity),
          price: dollars(l.unitCents),
        }))
      : [{ key: 0, description: "", quantity: "1", price: "" }],
  );
  const [seq, setSeq] = useState(rows.length);
  const [dirty, setDirty] = useState(false);
  const { send, undo, held, out } = useQuoteSend(orgId, quote);

  const parsed = useMemo(
    () =>
      rows.map((r) => ({
        description: r.description.trim(),
        quantity: Number(r.quantity || "1"),
        unitCents: parseCents(r.price || "0") ?? NaN,
      })),
    [rows],
  );
  const valid = parsed.filter((l) => Number.isFinite(l.unitCents) && Number.isInteger(l.quantity));
  const totals = quoteTotals(valid, quote.taxBps);
  const edit = (key: number, patch: Partial<Row>) => {
    setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  const save = async (): Promise<boolean> => {
    if (parsed.some((l) => !Number.isFinite(l.unitCents))) {
      toast({ title: "Check the prices: numbers like 1250 or 12.50.", tone: "error" });
      return false;
    }
    const r = await runAction(() =>
      saveDealQuoteLinesAction(
        orgId,
        quote.id,
        valid.filter((l) => l.description || l.unitCents),
      ),
    );
    if (!r || !r.ok) {
      if (r && !r.ok) toast({ title: r.error, tone: "error" });
      return false;
    }
    setDirty(false);
    router.refresh();
    return true;
  };

  const status =
    quote.status === "ACCEPTED"
      ? `Accepted${quote.acceptedName ? ` by ${quote.acceptedName}` : ""}.`
      : quote.status === "PAID"
        ? `Paid${quote.paidAt ? ` ${day(quote.paidAt)}` : ""}.`
        : quote.status === "SENT" && quote.sentAt
          ? `Sent ${day(quote.sentAt)}. You'll see it here when they open it.`
          : quote.status === "DECLINED" || quote.status === "EXPIRED"
            ? `${STATUS_WORD[quote.status]}. Change it and send it again.`
            : null;
  const canSend = !locked && quote.status !== "SENT";
  const reason = quote.to?.email
    ? `Goes to ${quote.to.name} in a tracked email`
    : "Add a contact with an email to the deal to send it";

  return (
    <section className="space-y-3" aria-label={`${word.title} ${quote.number}`}>
      <div className="flex items-baseline gap-2">
        <b className="text-[15px]">
          {word.title} {quote.number}
        </b>
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm">{STATUS_WORD[quote.status]}</span>
        <a
          href={`/app/${orgSlug}/crm/quotes/${quote.id}/pdf`}
          target="_blank"
          rel="noopener"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs font-semibold"
        >
          <Download className="size-3.5" aria-hidden="true" />
          PDF
        </a>
        <Link
          href={`/app/${orgSlug}/crm/quotes/${quote.id}?edit=1`}
          className="text-muted-foreground hover:text-foreground text-xs font-semibold"
        >
          All details
        </Link>
      </div>
      <ul className="bg-card ring-foreground/6 divide-border/60 divide-y rounded-2xl ring-1">
        {rows.map((r, i) => {
          const l = parsed[i]!;
          return (
            <li key={r.key} className="flex items-center gap-2 px-3 py-2">
              {locked ? (
                <>
                  <span className="min-w-0 flex-1 truncate text-[15px]">
                    {r.description}
                    {l.quantity > 1 ? ` (${l.quantity})` : ""}
                  </span>
                  <span className="text-[15px] tabular-nums">
                    {formatMoney(l.quantity * l.unitCents, quote.currency)}
                  </span>
                </>
              ) : (
                <>
                  <Input
                    aria-label="What it's for"
                    value={r.description}
                    placeholder="What it's for"
                    className="h-9 min-w-0 flex-1 border-transparent bg-transparent px-2 shadow-none"
                    onChange={(e) => edit(r.key, { description: e.target.value })}
                  />
                  <Input
                    aria-label="Quantity"
                    inputMode="numeric"
                    value={r.quantity}
                    className="h-9 w-14 border-transparent bg-transparent px-2 text-right shadow-none"
                    onChange={(e) => edit(r.key, { quantity: e.target.value.replace(/\D/g, "") })}
                  />
                  <Input
                    aria-label="Price"
                    inputMode="decimal"
                    value={r.price}
                    placeholder="$0"
                    className="h-9 w-24 border-transparent bg-transparent px-2 text-right shadow-none"
                    onChange={(e) => edit(r.key, { price: e.target.value })}
                  />
                  <button
                    type="button"
                    aria-label="Remove line"
                    title="Remove line"
                    className="text-muted-foreground hover:text-foreground grid size-7 place-items-center rounded-full"
                    onClick={() => {
                      setRows((cur) => cur.filter((x) => x.key !== r.key));
                      setDirty(true);
                    }}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </>
              )}
            </li>
          );
        })}
        <li className="flex items-center gap-2 px-5 py-3">
          {!locked && (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
              onClick={() => {
                setRows((cur) => [...cur, { key: seq, description: "", quantity: "1", price: "" }]);
                setSeq(seq + 1);
              }}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Line
            </button>
          )}
          <b className="ms-auto text-[15px]">Total</b>
          <b className="text-[17px] tabular-nums">{formatMoney(totals.totalCents, quote.currency)}</b>
        </li>
      </ul>
      {held || out ? (
        <SentLine kind={quote.kind} held={held} out={out} onUndo={() => void undo()} />
      ) : (
        <div className="flex flex-nowrap items-center gap-2">
          {dirty && (
            <AmbientButton
              action={{
                key: "save",
                label: "Save",
                tone: canSend ? "outline" : "solid",
                reason: "Changed, not saved",
                run: async () => ((await save()) ? {} : { error: "Not saved yet." }),
              }}
            />
          )}
          {canSend && quote.to?.email && (
            <AmbientButton
              action={{
                key: "send",
                label: `Send the ${word.one}`,
                tone: "solid",
                reason,
                run: () => send(dirty ? save : undefined),
              }}
            />
          )}
          {canSend ? (
            <AmbientWhy className="min-w-0 truncate">{reason}</AmbientWhy>
          ) : status ? (
            <span className="text-muted-foreground text-sm">{status}</span>
          ) : null}
        </div>
      )}
    </section>
  );
}
