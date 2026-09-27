"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { isNavItemActive, type NavItem } from "@/components/shell/nav-config";

export function SidebarNav({
  items,
  orgSlug,
  onNavigate,
}: {
  items: NavItem[];
  orgSlug: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {items.map((item) => {
        const href = item.href(orgSlug);
        const isActive = isNavItemActive(item, orgSlug, pathname, items);
        const Icon = item.icon;
        return (
          <Link
            key={item.label}
            href={href}
            onClick={onNavigate}
            aria-current={pathname === href ? "page" : isActive ? "true" : undefined}
            className={cn(
              "focus-visible:ring-ring flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
