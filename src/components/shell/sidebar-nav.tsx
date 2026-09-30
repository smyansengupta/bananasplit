"use client";

import { FileText, Pin, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";

import { unpinAction } from "@/app/app/[orgSlug]/_shell/pin-actions";
import {
  isNavItemActive,
  navGroups,
  navItems,
  settingsNavItem,
  type NavItem,
} from "@/components/shell/nav-config";
import { PIN_ICONS } from "@/components/shell/pin-icons";
import type { PinKind } from "@/lib/pins/pages";
import { cn } from "@/lib/utils";

export interface SidebarPin {
  id: string;
  href: string;
  label: string;
  kind: PinKind;
}

const itemClass = (active: boolean) =>
  cn(
    "focus-visible:ring-ring flex items-center gap-3 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
    active
      ? "bg-sidebar-accent text-sidebar-accent-foreground"
      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
  );

function NavLink({
  item,
  orgSlug,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  orgSlug: string;
  pathname: string;
  onNavigate?: () => void;
}) {
  const href = item.href(orgSlug);
  const isActive = isNavItemActive(item, orgSlug, pathname, navItems);
  const Icon = item.icon;
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={pathname === href ? "page" : isActive ? "true" : undefined}
      className={itemClass(isActive)}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {item.label}
    </Link>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-sidebar-foreground/50 px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wide uppercase">
      {children}
    </span>
  );
}

function PinnedList({
  pins,
  orgId,
  pathname,
  onNavigate,
}: {
  pins: SidebarPin[];
  orgId: string;
  pathname: string;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col">
      <GroupLabel>
        <span className="inline-flex items-center gap-1">
          <Pin className="size-3" aria-hidden="true" />
          Pinned
        </span>
      </GroupLabel>
      {pins.length === 0 ? (
        <p className="text-sidebar-foreground/50 px-3 py-1 text-xs leading-snug">
          Pin any page, note or task with the pin button at the top.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {pins.map((pin) => {
            const Icon = PIN_ICONS[pin.kind] ?? FileText;
            const active = pathname === pin.href;
            return (
              <li key={pin.id} className="group relative">
                <Link
                  href={pin.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(itemClass(active), "pr-8 font-normal")}
                >
                  <Icon className="size-4 shrink-0 opacity-70" aria-hidden="true" />
                  <span className="truncate">{pin.label}</span>
                </Link>
                <button
                  type="button"
                  disabled={pending}
                  aria-label={`Unpin ${pin.label}`}
                  onClick={() =>
                    start(async () => {
                      await unpinAction(orgId, pin.id);
                      router.refresh();
                    })
                  }
                  className="text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent focus-visible:ring-ring absolute top-1/2 right-1 grid size-6 -translate-y-1/2 place-items-center rounded opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function SidebarNav({
  orgSlug,
  orgId,
  pins = [],
  onNavigate,
}: {
  orgSlug: string;
  orgId: string;
  pins?: SidebarPin[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {navGroups.map((group, i) => (
          <div key={group.label ?? i} className="flex flex-col gap-0.5">
            {group.label && <GroupLabel>{group.label}</GroupLabel>}
            {group.items.map((item) => (
              <NavLink
                key={item.label}
                item={item}
                orgSlug={orgSlug}
                pathname={pathname}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ))}
        <PinnedList pins={pins} orgId={orgId} pathname={pathname} onNavigate={onNavigate} />
      </div>
      <div className="border-sidebar-border mt-3 border-t pt-3">
        <NavLink item={settingsNavItem} orgSlug={orgSlug} pathname={pathname} onNavigate={onNavigate} />
      </div>
    </nav>
  );
}
