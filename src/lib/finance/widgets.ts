import { parseBoard, type BoardWidget, type WidgetMeta } from "@/lib/boards";

import type { FinanceCardId } from "./dashboard-cards";

/**
 * The finance dashboard's widgets (src/lib/boards has the board itself).
 * A member who never touched their board gets DEFAULT_LAYOUT, trimmed to the
 * sections the org chose in setup (OrgSettings.financeDashboardCards).
 */

type FinanceWidgetMeta = WidgetMeta & { card?: FinanceCardId };

export const FINANCE_WIDGETS: readonly FinanceWidgetMeta[] = [
  { type: "balance", title: "Balance", description: "Money in minus money out this period.", group: "Numbers", icon: "Wallet", w: 1, h: null },
  { type: "in-out", title: "In and out", description: "Total money in and out this period.", group: "Numbers", icon: "ArrowLeftRight", w: 1, h: null },
  { type: "allocated", title: "Budgeted", description: "Everything allocated to categories.", group: "Numbers", icon: "PiggyBank", w: 1, h: null },
  { type: "owed", title: "Owed to members", description: "Expenses submitted or approved, not yet paid back.", group: "Numbers", icon: "HandCoins", w: 1, h: null },
  { type: "pending", title: "Waiting for approval", description: "Reimbursement requests to review.", group: "Numbers", icon: "Hourglass", w: 1, h: null },
  { type: "burn", title: "Money in and out by month", description: "A bar chart of each month's income and spending.", group: "Charts", icon: "ChartColumn", w: 2, h: null, card: "burn" },
  { type: "trend", title: "Balance over time", description: "How the balance moved through the period.", group: "Charts", icon: "ChartLine", w: 2, h: null },
  { type: "by-category", title: "Spending by category", description: "Where the money went, as a donut chart.", group: "Charts", icon: "ChartPie", w: 2, h: null, card: "categories" },
  { type: "by-kind", title: "By transaction type", description: "Expenses, sponsorships, income and adjustments.", group: "Charts", icon: "ChartBar", w: 2, h: null },
  { type: "budget", title: "Budget vs. actual", description: "Spent against each category's allocation.", group: "Budget", icon: "Target", w: 2, h: null, card: "categories" },
  { type: "runway", title: "Runway", description: "When the money runs out at the current pace.", group: "Budget", icon: "Timer", w: 4, h: null, card: "runway" },
  { type: "sponsorships", title: "Sponsorships", description: "Committed vs. received.", group: "Budget", icon: "Handshake", w: 1, h: null, card: "sponsorships" },
  { type: "recent", title: "Recent transactions", description: "The latest money in and out.", group: "Lists", icon: "ReceiptText", w: 2, h: null },
  { type: "top-expenses", title: "Biggest expenses", description: "This period's largest spending.", group: "Lists", icon: "TrendingDown", w: 2, h: null },
  { type: "left-to-spend", title: "Left to spend", description: "Budgeted minus spent, across every category.", group: "Budget", icon: "PiggyBank", w: 1, h: null },
  { type: "income-sources", title: "Where money came from", description: "Money in by type: dues, sponsors, school funding.", group: "Charts", icon: "ChartPie", w: 2, h: null },
  { type: "reimbursements", title: "Reimbursement requests", description: "Who's waiting to be paid back, and how much.", group: "Lists", icon: "HandCoins", w: 2, h: null },
  { type: "shortcuts", title: "Shortcuts", description: "Import a spreadsheet, the budget, requests to review, the setup guide.", group: "Tools", icon: "Zap", w: 2, h: null },
  { type: "setup", title: "Finance setup", description: "What's set up and what's left, each a click away.", group: "Tools", icon: "ListChecks", w: 2, h: null },
];

export type WidgetTypeId = (typeof FINANCE_WIDGETS)[number]["type"];
export const FINANCE_WIDGET_TYPES = FINANCE_WIDGETS.map((w) => w.type);

const DEFAULT_LAYOUT: readonly BoardWidget[] = [
  { id: "balance", type: "balance", w: 1, h: null },
  { id: "in-out", type: "in-out", w: 1, h: null },
  { id: "owed", type: "owed", w: 1, h: null },
  { id: "pending", type: "pending", w: 1, h: null },
  { id: "burn", type: "burn", w: 2, h: null },
  { id: "by-category", type: "by-category", w: 2, h: null },
  { id: "budget", type: "budget", w: 2, h: null },
  { id: "recent", type: "recent", w: 2, h: null },
  { id: "runway", type: "runway", w: 4, h: null },
  { id: "sponsorships", type: "sponsorships", w: 1, h: null },
];

/** The member's saved board, or the default filtered to the org's setup choices. */
export function resolveLayout(saved: unknown, orgCards: ReadonlySet<FinanceCardId>): BoardWidget[] {
  if (saved != null) {
    const parsed = parseBoard(saved, FINANCE_WIDGET_TYPES);
    if (parsed) return parsed;
  }
  return DEFAULT_LAYOUT.filter((w) => {
    const card = FINANCE_WIDGETS.find((m) => m.type === w.type)?.card;
    return !card || orgCards.has(card);
  });
}
