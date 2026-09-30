/**
 * The finance dashboard's optional sections, chosen in org setup (B4) and
 * stored in OrgSettings.financeDashboardCards. An empty list shows all of
 * them, so orgs that never ran setup keep the full dashboard. The balance
 * row at the top always shows.
 */

export const FINANCE_CARDS = [
  {
    id: "categories",
    title: "Budget vs. actual",
    detail: "Spent against each category's allocation",
  },
  { id: "runway", title: "Runway", detail: "When the money runs out, at the current pace" },
  { id: "sponsorships", title: "Sponsorships", detail: "Committed vs. received" },
  { id: "burn", title: "Spend by month", detail: "Money out per month this period" },
] as const;

export type FinanceCardId = (typeof FINANCE_CARDS)[number]["id"];

export const FINANCE_CARD_IDS: readonly FinanceCardId[] = FINANCE_CARDS.map((c) => c.id);

export function isFinanceCardId(value: unknown): value is FinanceCardId {
  return typeof value === "string" && (FINANCE_CARD_IDS as readonly string[]).includes(value);
}

/** The stored list as the set of sections to show (empty or unknown-only = all). */
export function visibleFinanceCards(
  stored: readonly string[] | null | undefined,
): Set<FinanceCardId> {
  const known = (stored ?? []).filter(isFinanceCardId);
  return new Set(known.length > 0 ? known : FINANCE_CARD_IDS);
}
