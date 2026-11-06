"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Columns3,
  Plug,
  UserRound,
  Users,
  Zap,
  type IconComponent,
} from "@/components/icons";
import { Card } from "@/components/ui/card";
import { chipClass } from "@/components/ui/segmented";
import type { CrmSettingsSectionId } from "@/lib/crm/settings-sections";
import { cn } from "@/lib/utils";

const ICONS: Record<string, IconComponent> = { Columns3, Plug, UserRound, Users, Zap };

export interface CrmSettingsNavItem {
  id: CrmSettingsSectionId;
  label: string;
  icon: string;
  href: string;
}

/**
 * CRM settings' list, drawn like the Admin panel's (SettingsSubnav): one
 * card of icon and label rows beside the section on wide screens, the open
 * section a filled pill; a scrolling strip of pills on phones and tablets.
 */
export function CrmSettingsNav({ items }: { items: CrmSettingsNavItem[] }) {
  const pathname = usePathname() ?? "";
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  return (
    <nav aria-label="CRM settings">
      <div className="-mx-4 [scrollbar-width:none] overflow-x-auto px-4 pb-1 lg:hidden">
        <ul className="flex min-w-max gap-2">
          {items.map((item) => {
            const active = isActive(item.href);
            const Icon = ICONS[item.icon] ?? Zap;
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  ref={
                    active
                      ? (el) => el?.scrollIntoView({ block: "nearest", inline: "nearest" })
                      : undefined
                  }
                  className={chipClass(active)}
                >
                  <Icon aria-hidden="true" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <Card className="hidden gap-0.5 p-3 lg:flex">
        {items.map((item) => {
          const active = isActive(item.href);
          const Icon = ICONS[item.icon] ?? Zap;
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={pathname === item.href ? "page" : active ? "true" : undefined}
              className={cn(
                "rounded-field focus-visible:outline-foreground flex min-h-10 items-center gap-3 px-3 py-2 text-sm transition-colors outline-none focus-visible:outline-2 focus-visible:-outline-offset-2",
                active
                  ? "bg-muted text-foreground font-semibold"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground font-medium",
              )}
            >
              <Icon className="size-[18px] shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">{item.label}</span>
            </Link>
          );
        })}
      </Card>
    </nav>
  );
}
