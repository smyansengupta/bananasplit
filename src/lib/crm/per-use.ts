/**
 * Rough list prices for what an organization pays per use on its own keys
 * (docs/features/crm.md, "Whose keys pay for what"), in micro-dollars, for
 * the monthly spending cap and the estimate only: the provider's own bill
 * is the truth. Pure and client-safe; src/server/crm/spend.ts meters them.
 */

export type PerUse =
  | "tavily.search"
  | "hunter.lookup"
  | "prospeo.lookup"
  | "claude.web_search"
  | "text.segment"
  | "call.minute"
  | "transcript.minute"
  | "email.sent";

export const PER_USE_MICROS: Record<PerUse, number> = {
  "tavily.search": 8_000,
  "hunter.lookup": 30_000,
  "prospeo.lookup": 20_000,
  "claude.web_search": 10_000,
  "text.segment": 8_000,
  "call.minute": 14_000,
  "transcript.minute": 4_300,
  "email.sent": 900,
};

/** An estimate for `units` of `what`, in micro-dollars. */
export function costOf(what: PerUse, units = 1): number {
  return Math.max(0, Math.round(units)) * PER_USE_MICROS[what];
}

/** How many SMS segments a text takes (160 characters alone, 153 each when split). */
export function textSegments(body: string): number {
  const n = [...body].length;
  return n <= 160 ? 1 : Math.ceil(n / 153);
}

/** Billed minutes for a length in seconds (providers round up). */
export function billedMinutes(seconds: number | null | undefined): number {
  return seconds && seconds > 0 ? Math.ceil(seconds / 60) : 0;
}
