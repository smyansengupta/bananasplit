import { z } from "zod";

import type { FinanceCardId } from "./dashboard-cards";

/**
 * The finance dashboard's widgets. Each member arranges their own board
 * (MemberPrefs.financeWidgets): which widgets, in what order, how wide.
 * A member who never touched it gets DEFAULT_LAYOUT, trimmed to the
 * sections the org chose in setup (OrgSettings.financeDashboardCards).
 */

export const WIDGET_SIZES = ["sm", "md", "lg"] as const;
export type WidgetSize = (typeof WIDGET_SIZES)[number];

export const WIDGET_GROUPS = ["Numbers", "Charts", "Budget", "Lists"] as const;
export type WidgetGroup = (typeof WIDGET_GROUPS)[number];

export interface WidgetType {
  type: string;
  title: string;
  description: string;
  group: WidgetGroup;
  /** lucide icon name, resolved in the board. */
  icon: string;
  size: WidgetSize;
  /** The org setup section it belongs to, if any (B4's choices). */
  card?: FinanceCardId;
}

export const WIDGET_TYPES = [
  { type: "balance", title: "Balance", description: "Money in minus money out this period.", group: "Numbers", icon: "Wallet", size: "sm" },
  { type: "in-out", title: "In and out", description: "Total money in and out this period.", group: "Numbers", icon: "ArrowLeftRight", size: "sm" },
  { type: "allocated", title: "Budgeted", description: "Everything allocated to categories.", group: "Numbers", icon: "PiggyBank", size: "sm" },
  { type: "owed", title: "Owed to members", description: "Expenses submitted or approved, not yet paid back.", group: "Numbers", icon: "HandCoins", size: "sm" },
  { type: "pending", title: "Waiting for approval", description: "Reimbursement requests to review.", group: "Numbers", icon: "Hourglass", size: "sm" },
  { type: "burn", title: "Money in and out by month", description: "A bar chart of each month's income and spending.", group: "Charts", icon: "ChartColumn", size: "md", card: "burn" },
  { type: "trend", title: "Balance over time", description: "How the balance moved through the period.", group: "Charts", icon: "ChartLine", size: "md" },
  { type: "by-category", title: "Spending by category", description: "Where the money went, as a donut chart.", group: "Charts", icon: "ChartPie", size: "md", card: "categories" },
  { type: "by-kind", title: "By transaction type", description: "Expenses, sponsorships, income and adjustments.", group: "Charts", icon: "ChartBar", size: "md" },
  { type: "budget", title: "Budget vs. actual", description: "Spent against each category's allocation.", group: "Budget", icon: "Target", size: "md", card: "categories" },
  { type: "runway", title: "Runway", description: "When the money runs out at the current pace.", group: "Budget", icon: "Timer", size: "lg", card: "runway" },
  { type: "sponsorships", title: "Sponsorships", description: "Committed vs. received.", group: "Budget", icon: "Handshake", size: "sm", card: "sponsorships" },
  { type: "recent", title: "Recent transactions", description: "The latest money in and out.", group: "Lists", icon: "ReceiptText", size: "md" },
  { type: "top-expenses", title: "Biggest expenses", description: "This period's largest spending.", group: "Lists", icon: "TrendingDown", size: "md" },
] as const satisfies readonly WidgetType[];

export type WidgetTypeId = (typeof WIDGET_TYPES)[number]["type"];

export const WIDGET_TYPE_IDS = WIDGET_TYPES.map((w) => w.type) as readonly WidgetTypeId[];

export function widgetType(type: WidgetTypeId): WidgetType {
  return WIDGET_TYPES.find((w) => w.type === type)!;
}

export const MAX_WIDGETS = 24;

export const widgetSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,40}$/),
    type: z.enum(WIDGET_TYPE_IDS as [WidgetTypeId, ...WidgetTypeId[]]),
    size: z.enum(WIDGET_SIZES),
  })
  .strict();

export type Widget = z.infer<typeof widgetSchema>;

export const layoutSchema = z.array(widgetSchema).max(MAX_WIDGETS);

const DEFAULT_LAYOUT: readonly Widget[] = [
  { id: "balance", type: "balance", size: "sm" },
  { id: "in-out", type: "in-out", size: "sm" },
  { id: "owed", type: "owed", size: "sm" },
  { id: "pending", type: "pending", size: "sm" },
  { id: "burn", type: "burn", size: "md" },
  { id: "by-category", type: "by-category", size: "md" },
  { id: "budget", type: "budget", size: "md" },
  { id: "recent", type: "recent", size: "md" },
  { id: "runway", type: "runway", size: "lg" },
  { id: "sponsorships", type: "sponsorships", size: "sm" },
];

/**
 * The member's saved board, or the default one filtered to the org's
 * setup choices. A saved value that no longer parses falls back too.
 */
export function resolveLayout(saved: unknown, orgCards: ReadonlySet<FinanceCardId>): Widget[] {
  const parsed = layoutSchema.safeParse(saved);
  if (saved != null && parsed.success) return parsed.data;
  return DEFAULT_LAYOUT.filter((w) => {
    const card = (widgetType(w.type) as WidgetType).card;
    return !card || orgCards.has(card);
  });
}

/** A fresh id for a widget of `type` not already on the board. */
export function newWidgetId(type: WidgetTypeId, layout: readonly Widget[]): string {
  const taken = new Set(layout.map((w) => w.id));
  if (!taken.has(type)) return type;
  for (let i = 2; ; i++) if (!taken.has(`${type}-${i}`)) return `${type}-${i}`;
}
