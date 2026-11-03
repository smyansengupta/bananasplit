/**
 * The CRM's tabs, in one list, so later phases add a tab by adding an
 * entry (Phase 2: Outreach and Campaigns; Phase 3: Automations and
 * Forecast; Phase 4: Review for AI changes). `pipelines` stands for one tab
 * per pipeline, in the pipelines' own order.
 */

export interface CrmTab {
  id: string;
  label: string;
  /** Icon name (@/components/icons). */
  icon: string;
  /** Path under /app/{slug}/crm ("" is the CRM's home). */
  path: string;
  /** Only owners, admins and CRM managers see it. */
  managersOnly?: boolean;
  /** Active only on its own URL. */
  exact?: boolean;
}

export type CrmTabEntry = CrmTab | { id: "pipelines" };

export const CRM_TABS: readonly CrmTabEntry[] = [
  { id: "today", label: "Today", icon: "Sunrise", path: "", exact: true },
  { id: "people", label: "People", icon: "Users", path: "/people" },
  { id: "companies", label: "Companies", icon: "Building2", path: "/companies" },
  { id: "pipelines" },
  { id: "queue", label: "Review", icon: "Inbox", path: "/queue" },
  { id: "forecast", label: "Forecast", icon: "ChartLine", path: "/forecast" },
  { id: "automations", label: "Automations", icon: "Zap", path: "/automations", managersOnly: true },
  // Phase 5: calls (the dialer) and quotes.
  { id: "calls", label: "Calls", icon: "Phone", path: "/calls" },
  { id: "quotes", label: "Quotes", icon: "ReceiptText", path: "/quotes" },
  { id: "review", label: "Duplicates", icon: "Merge", path: "/review" },
  { id: "settings", label: "Settings", icon: "Settings", path: "/settings", managersOnly: true },
];

export interface ResolvedCrmTab {
  id: string;
  label: string;
  icon: string;
  href: string;
  exact?: boolean;
  count?: number;
}

/** The tabs a viewer sees, with each pipeline in place of `pipelines`. */
export function resolveCrmTabs(
  orgSlug: string,
  pipelines: readonly { id: string; name: string; icon?: string | null }[],
  options: { manager: boolean; counts?: Record<string, number> },
): ResolvedCrmTab[] {
  const base = `/app/${orgSlug}/crm`;
  const out: ResolvedCrmTab[] = [];
  for (const entry of CRM_TABS) {
    if (!("label" in entry)) {
      for (const p of pipelines) {
        out.push({
          id: `pipeline:${p.id}`,
          label: p.name,
          icon: p.icon || "Columns3",
          href: `${base}/pipelines/${p.id}`,
        });
      }
      continue;
    }
    if (entry.managersOnly && !options.manager) continue;
    out.push({
      id: entry.id,
      label: entry.label,
      icon: entry.icon,
      href: `${base}${entry.path}`,
      exact: entry.exact,
      count: options.counts?.[entry.id],
    });
  }
  return out;
}
