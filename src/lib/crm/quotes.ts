/**
 * Quotes and invoices, the pure parts (docs/features/crm.md, CrmQuote):
 * line totals in integer cents, tax in basis points, numbering per
 * organization and kind, the public link's token shape, and what a quote's
 * state means on screen. Client-safe.
 */

export type QuoteKind = "quote" | "invoice";

export const QUOTE_KINDS: readonly QuoteKind[] = ["quote", "invoice"];

export const KIND_WORD: Record<QuoteKind, { one: string; title: string; prefix: string }> = {
  quote: { one: "quote", title: "Quote", prefix: "Q" },
  invoice: { one: "invoice", title: "Invoice", prefix: "INV" },
};

export type QuoteStatus = "DRAFT" | "SENT" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "PAID";

export const STATUS_WORD: Record<QuoteStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  EXPIRED: "Expired",
  PAID: "Paid",
};

export interface LineInput {
  description: string;
  quantity: number;
  unitCents: number;
}

export interface QuoteTotals {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

export const MAX_LINES = 100;
/** The most any one line or quote may come to: $100 million. */
export const MAX_CENTS = 10_000_000_000;

/** One line's amount. */
export function lineCents(line: Pick<LineInput, "quantity" | "unitCents">): number {
  return line.quantity * line.unitCents;
}

/**
 * Subtotal, tax and total. Tax is rounded half away from zero on the
 * subtotal once (not per line), the way invoices are usually checked.
 */
export function quoteTotals(lines: readonly Pick<LineInput, "quantity" | "unitCents">[], taxBps = 0): QuoteTotals {
  const subtotalCents = lines.reduce((sum, l) => sum + lineCents(l), 0);
  const raw = (subtotalCents * taxBps) / 10_000;
  const taxCents = Math.sign(raw) * Math.round(Math.abs(raw));
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

export class QuoteInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuoteInputError";
  }
}

/** "1,250.50", "$12", "12.5" as cents; null when it isn't an amount. */
export function parseCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isFinite(input) ? Math.round(input * 100) : null;
  const s = input.replace(/[\s,$€£]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return s.startsWith("-") ? -cents : cents;
}

/** "8.25" (percent) as basis points; null when it isn't a rate from 0 to 100. */
export function parseTaxBps(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === "") return 0;
  const n = typeof input === "number" ? input : Number(String(input).replace("%", "").trim());
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100);
}

/** Lines checked and cleaned: words for the person when something's wrong. */
export function cleanLines(lines: readonly Partial<LineInput>[]): LineInput[] {
  if (lines.length > MAX_LINES) throw new QuoteInputError(`Keep it to ${MAX_LINES} lines.`);
  const out: LineInput[] = [];
  for (const [i, l] of lines.entries()) {
    const description = String(l.description ?? "").trim().slice(0, 500);
    const quantity = Number(l.quantity ?? 1);
    const unitCents = Number(l.unitCents ?? 0);
    if (!description && !unitCents) continue;
    if (!description) throw new QuoteInputError(`Say what line ${i + 1} is for.`);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000) {
      throw new QuoteInputError(`Line ${i + 1}: the quantity is a whole number from 1.`);
    }
    if (!Number.isInteger(unitCents) || Math.abs(unitCents) > MAX_CENTS) {
      throw new QuoteInputError(`Line ${i + 1}: check the price.`);
    }
    if (Math.abs(quantity * unitCents) > MAX_CENTS) throw new QuoteInputError(`Line ${i + 1} is too large.`);
    out.push({ description, quantity, unitCents });
  }
  return out;
}

/** "Q-0007" from the kind and a sequence number. */
export function formatQuoteNumber(kind: QuoteKind, n: number): string {
  return `${KIND_WORD[kind].prefix}-${String(n).padStart(4, "0")}`;
}

/** The sequence number in "Q-0007" (7), or null for a number of another kind or shape. */
export function quoteSequence(kind: QuoteKind, number: string): number | null {
  const m = new RegExp(`^${KIND_WORD[kind].prefix}-(\\d+)$`).exec(number);
  return m ? Number(m[1]) : null;
}

/** The next number after the organization's existing ones of this kind. */
export function nextQuoteNumber(kind: QuoteKind, existing: readonly string[]): string {
  let max = 0;
  for (const n of existing) {
    const seq = quoteSequence(kind, n);
    if (seq !== null && seq > max) max = seq;
  }
  return formatQuoteNumber(kind, max + 1);
}

/**
 * The public link's token: `{orgId}.{secret}`. The organization is in the
 * clear so the page can open that one organization's context; the secret
 * (32 random bytes, base64url) is what proves the link, and only its hash
 * with the org is stored.
 */
const TOKEN = /^([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9_-]{40,64})$/;

export function parsePublicToken(token: string): { orgId: string; secret: string } | null {
  const m = TOKEN.exec(token);
  return m ? { orgId: m[1]!, secret: m[2]! } : null;
}

/** Has it passed its valid-until day (the whole day counts)? */
export function isPastValid(validUntil: Date | null | undefined, now: Date = new Date()): boolean {
  if (!validUntil) return false;
  const end = new Date(validUntil);
  end.setUTCHours(23, 59, 59, 999);
  return now.getTime() > end.getTime();
}

/** What the recipient may still do on the public page. */
export function canRespond(q: { status: QuoteStatus; validUntil: Date | null; kind: QuoteKind }, now = new Date()): boolean {
  if (q.status !== "SENT") return false;
  return !isPastValid(q.validUntil, now);
}

/** The status as it stands now (a sent quote past its date reads Expired). */
export function effectiveStatus(q: { status: QuoteStatus; validUntil: Date | null }, now = new Date()): QuoteStatus {
  return q.status === "SENT" && isPastValid(q.validUntil, now) ? "EXPIRED" : q.status;
}

/** A typed name that counts as a signature: two letters at least, no links. */
export function cleanSignature(input: string | null | undefined): string | null {
  const s = (input ?? "").replace(/\s+/g, " ").trim();
  if (s.length < 2 || s.length > 120) return null;
  if (!/\p{L}.*\p{L}/u.test(s)) return null;
  if (/https?:|www\.|[<>]/i.test(s)) return null;
  return s;
}
