/**
 * Split the cost (docs/features/rsvp.md): a host asks each guest for a set
 * price, or shares a total among everyone going, and guests pay the host
 * directly through Venmo, Cash App, PayPal or Zelle. Bananasplit moves no
 * money and takes no fee; it does the math, opens the payment app with the
 * amount filled in, and keeps track of who says they paid.
 */

export type CostMode = "NONE" | "EACH" | "SPLIT";

/** Where guests pay the host. Each is the bare handle, no @ or $. */
export interface PayTo {
  venmo?: string;
  cashapp?: string;
  paypal?: string;
  /** An email address or phone number: Zelle has no web link. */
  zelle?: string;
}

export const PAY_APPS = ["venmo", "cashapp", "paypal", "zelle"] as const;
export type PayApp = (typeof PAY_APPS)[number];

export const PAY_APP_LABEL: Record<PayApp, string> = {
  venmo: "Venmo",
  cashapp: "Cash App",
  paypal: "PayPal",
  zelle: "Zelle",
};

export function hasPayTo(payTo: PayTo): boolean {
  return PAY_APPS.some((app) => Boolean(payTo[app]));
}

/**
 * What one guest owes right now. EACH: the price. SPLIT: the total over
 * everyone going (counting a guest who is about to sign up when
 * `includingNew`), rounded up to the cent, so the host is never short.
 */
export function shareCents(
  mode: CostMode,
  cents: number | null,
  going: number,
  options: { includingNew?: boolean } = {},
): number | null {
  if (mode === "NONE" || cents === null) return null;
  if (mode === "EACH") return cents;
  const people = Math.max(1, going + (options.includingNew ? 1 : 0));
  return Math.ceil(cents / people);
}

/** "$4", "$4.50", "$1,200": whole dollars without cents. */
export function formatCents(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars)
    ? `$${dollars.toLocaleString("en-US")}`
    : `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Dollars as a payment link wants them: "4.50". */
function plainAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** "12.50" or "$12.50" typed by a host, in cents; null when it isn't money. */
export function parseDollars(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

export interface PayLink {
  app: PayApp;
  label: string;
  /** Opens the app (or site) with the amount filled in; null for Zelle. */
  href: string | null;
  /** Zelle: who to send it to. */
  detail: string | null;
}

/** One way to pay per app the host offers, in a fixed order. */
export function payLinks(payTo: PayTo, cents: number, note: string): PayLink[] {
  const amount = plainAmount(cents);
  const memo = note.slice(0, 80);
  const links: PayLink[] = [];
  if (payTo.venmo) {
    const query = new URLSearchParams({ txn: "pay", amount, note: memo });
    links.push({
      app: "venmo",
      label: PAY_APP_LABEL.venmo,
      href: `https://venmo.com/${encodeURIComponent(payTo.venmo)}?${query.toString()}`,
      detail: `@${payTo.venmo}`,
    });
  }
  if (payTo.cashapp) {
    links.push({
      app: "cashapp",
      label: PAY_APP_LABEL.cashapp,
      href: `https://cash.app/$${encodeURIComponent(payTo.cashapp)}/${amount}`,
      detail: `$${payTo.cashapp}`,
    });
  }
  if (payTo.paypal) {
    links.push({
      app: "paypal",
      label: PAY_APP_LABEL.paypal,
      href: `https://www.paypal.com/paypalme/${encodeURIComponent(payTo.paypal)}/${amount}USD`,
      detail: `paypal.me/${payTo.paypal}`,
    });
  }
  if (payTo.zelle) {
    links.push({ app: "zelle", label: PAY_APP_LABEL.zelle, href: null, detail: payTo.zelle });
  }
  return links;
}

/** The line under the price: "each" or "split between everyone going". */
export function costLine(mode: CostMode, cents: number, going: number): string {
  if (mode === "EACH") return `${formatCents(cents)} each`;
  const each = shareCents(mode, cents, going) ?? cents;
  return going > 1
    ? `${formatCents(cents)} split ${going} ways, ${formatCents(each)} each right now`
    : `${formatCents(cents)} split between everyone going`;
}
