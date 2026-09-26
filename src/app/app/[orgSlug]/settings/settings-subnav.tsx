"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

import { isSettingsItemActive, type SettingsNavItem } from "./settings-nav";

export function SettingsSubnav({ items }: { items: SettingsNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Settings" className="-mx-1 overflow-x-auto px-1 pb-1">
      <div className="bg-muted inline-flex min-w-max items-center gap-1 rounded-lg p-1">
        {items.map((item) => {
          const active = isSettingsItemActive(item, pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={pathname === item.href ? "page" : active ? "true" : undefined}
              className={cn(
                "focus-visible:ring-ring rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:outline-none",
                active ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
