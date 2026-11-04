"use client";

import { Columns3, Sunrise, Users, type IconComponent } from "@/components/icons";

import { usePathname } from "next/navigation";

import { PageTabs } from "@/components/ui/page-tabs";
import { crmTabActive, type ResolvedCrmTab } from "@/lib/crm/nav";

/** Icons the CRM's tabs name (src/lib/crm/nav.ts). */
const CRM_ICONS: Record<string, IconComponent> = { Sunrise, Users };

/**
 * The CRM's two tabs (Today and People): the same switch bar
 * as every section's pages. A tab stays lit on the older pages it holds.
 */
export function CrmTabs({ tabs, className }: { tabs: readonly ResolvedCrmTab[]; className?: string }) {
  const pathname = usePathname() ?? "";
  return (
    <PageTabs
      label="CRM"
      className={className}
      tabs={tabs.map((t) => ({
        href: t.href,
        label: t.label,
        icon: CRM_ICONS[t.icon] ?? Columns3,
        active: crmTabActive(t, pathname),
        count: t.count,
        warm: true,
      }))}
    />
  );
}
