"use client";

import {
  Briefcase,
  Building2,
  ChartLine,
  Columns3,
  Handshake,
  HandCoins,
  Inbox,
  Megaphone,
  Merge,
  Mic,
  Package,
  Phone,
  PiggyBank,
  ReceiptText,
  Send,
  Settings,
  Sunrise,
  UserPlus,
  Users,
  Zap,
  type IconComponent,
} from "@/components/icons";

import { usePathname } from "next/navigation";

import { PageTabs } from "@/components/ui/page-tabs";
import { crmTabActive, type ResolvedCrmTab } from "@/lib/crm/nav";

/** Icons the CRM's tabs and pipelines name (src/lib/crm/nav.ts, templates.ts). */
export const CRM_ICONS: Record<string, IconComponent> = {
  Briefcase,
  Building2,
  ChartLine,
  Columns3,
  Handshake,
  HandCoins,
  Inbox,
  Megaphone,
  Merge,
  Mic,
  Package,
  Phone,
  PiggyBank,
  ReceiptText,
  Send,
  Settings,
  Sunrise,
  UserPlus,
  Users,
  Zap,
};

/**
 * The CRM's four tabs (Today, People, Deals, Outreach): the same switch bar
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
      }))}
    />
  );
}
