/**
 * All money in this app is an integer count of cents. Never a float, never
 * JS division/multiplication on a dollar amount — that's how `0.1 + 0.2`
 * class bugs get into a ledger. This module is the only place allowed to
 * convert between the two representations.
 */

/** Parses a user-entered dollar string ("12.5", "$1,234.00", "-3") into integer cents. Throws on anything that isn't a valid amount. */
export function parseDollarsToCents(input: string): number {
  const cleaned = input.trim().replace(/[$,]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new Error(`Not a valid dollar amount: "${input}"`);
  }
  const negative = cleaned.startsWith("-");
  const unsigned = negative ? cleaned.slice(1) : cleaned;
  const [dollars, cents = ""] = unsigned.split(".");
  const centsPadded = (cents + "00").slice(0, 2);
  const total = Number(dollars) * 100 + Number(centsPadded);
  return negative ? -total : total;
}

/** Formats integer cents as a dollar string, e.g. 123456 -> "$1,234.56". */
export function formatCents(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** Sums a list of integer cent amounts, staying in integer arithmetic throughout. */
export function sumCents(amounts: readonly number[]): number {
  let total = 0;
  for (const amount of amounts) {
    if (!Number.isInteger(amount)) {
      throw new Error(`sumCents received a non-integer amount: ${amount}`);
    }
    total += amount;
  }
  return total;
}
