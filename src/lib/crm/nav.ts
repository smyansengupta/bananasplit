/**
 * The CRM's tabs (docs/features/crm.md, "Redesign"): four, in one list.
 * Everything else lives under one of them (People | Companies is a switch
 * on People; pipelines, forecast and quotes are Deals; campaigns are
 * Outreach) or behind the settings button in the header. A tab stays lit
 * on the older pages it now holds, through `also`, until they move.
 */

export interface CrmTab {
  id: string;
  label: string;
  /** Icon name (@/components/icons). */
  icon: string;
  /** Path under /app/{slug}/crm ("" is the CRM's home). */
  path: string;
  /** Active only on its own URL (besides `also`). */
  exact?: boolean;
  /** Other paths under /app/{slug}/crm this tab is lit on. */
  also?: readonly string[];
}

export const CRM_TABS: readonly CrmTab[] = [
  {
    id: "today",
    label: "Today",
    icon: "Sunrise",
    path: "",
    exact: true,
    also: ["/queue", "/review", "/calls", "/scan"],
  },
  {
    id: "people",
    label: "People",
    icon: "Users",
    path: "/people",
    also: ["/companies", "/import", "/handover"],
  },
  {
    id: "deals",
    label: "Deals",
    icon: "Columns3",
    path: "/deals",
    also: ["/pipelines", "/items", "/forecast", "/quotes"],
  },
  { id: "outreach", label: "Outreach", icon: "Send", path: "/outreach", also: ["/campaigns"] },
];

export interface ResolvedCrmTab {
  id: string;
  label: string;
  icon: string;
  href: string;
  exact?: boolean;
  /** Full paths (under the CRM) this tab is also lit on. */
  also?: string[];
  count?: number;
}

/**
 * The tabs a viewer sees. `pipelines` and `manager` are kept for the
 * callers that pass them; the four tabs are the same for everyone.
 */
export function resolveCrmTabs(
  orgSlug: string,
  _pipelines: readonly { id: string; name: string; icon?: string | null }[] = [],
  options: { manager?: boolean; counts?: Record<string, number> } = {},
): ResolvedCrmTab[] {
  const base = `/app/${orgSlug}/crm`;
  return CRM_TABS.map((entry) => ({
    id: entry.id,
    label: entry.label,
    icon: entry.icon,
    href: `${base}${entry.path}`,
    exact: entry.exact,
    also: entry.also?.map((p) => `${base}${p}`),
    count: options.counts?.[entry.id],
  }));
}

/** Whether `pathname` is on this tab: its own URL, below it (unless exact), or one of the pages it holds. */
export function crmTabActive(
  tab: Pick<ResolvedCrmTab, "href" | "exact" | "also">,
  pathname: string,
): boolean {
  const under = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  if (pathname === tab.href) return true;
  if (!tab.exact && under(tab.href)) return true;
  return (tab.also ?? []).some(under);
}
