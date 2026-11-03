"use client";

import {
  Briefcase,
  Building2,
  Columns3,
  Handshake,
  HandCoins,
  Megaphone,
  Merge,
  Mic,
  Package,
  PiggyBank,
  Send,
  Settings,
  Sunrise,
  UserPlus,
  Users,
  type IconComponent,
} from "@/components/icons";

import { PageTabs } from "@/components/ui/page-tabs";
import type { ResolvedCrmTab } from "@/lib/crm/nav";

/** Icons the CRM's tabs and pipelines name (src/lib/crm/nav.ts, templates.ts). */
export const CRM_ICONS: Record<string, IconComponent> = {
  Briefcase,
  Building2,
  Columns3,
  Handshake,
  HandCoins,
  Megaphone,
  Merge,
  Mic,
  Package,
  PiggyBank,
  Send,
  Settings,
  Sunrise,
  UserPlus,
  Users,
};

/** The CRM's tab bar: the same switch bar as every section's pages. */
export function CrmTabs({ tabs }: { tabs: readonly ResolvedCrmTab[] }) {
  return (
    <PageTabs
      label="CRM"
      tabs={tabs.map((t) => ({
        href: t.href,
        label: t.label,
        icon: CRM_ICONS[t.icon] ?? Columns3,
        exact: t.exact,
        count: t.count,
      }))}
    />
  );
}
