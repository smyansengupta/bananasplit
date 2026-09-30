"use client";

import {
  CalendarCheck,
  CalendarDays,
  CheckSquare,
  Database,
  FileText,
  LayoutDashboard,
  Network,
  NotebookText,
  Pin,
  Settings,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";

import { unpinAction } from "@/app/app/[orgSlug]/_shell/pin-actions";
import { isLinkActive, type NavLink, type NavSection } from "@/components/shell/nav-config";
import { usePinDrop } from "@/components/pins/pin-dnd";
import { PIN_ICONS } from "@/components/shell/pin-icons";
import type { PinKind } from "@/lib/pins/pages";
import { cn } from "@/lib/utils";

export interface SidebarPin {
  id: string;
  href: string;
  label: string;
  kind: PinKind;
}

const NAV_ICONS: Record<string, LucideIcon> = {
  CalendarCheck,
  CalendarDays,
  CheckSquare,
  Database,
  LayoutDashboard,
  Network,
  NotebookText,
  Settings,
  Users,
  Wallet,
};

const itemClass = (active: boolean) =>
  cn(
    "focus-visible:ring-ring flex items-center gap-3 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
    active
      ? "bg-sidebar-accent text-sidebar-accent-foreground"
      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
  );

function NavItemLink({
  link,
  pathname,
  all,
  onNavigate,
}: {
  link: NavLink;
  pathname: string;
  all: readonly NavLink[];
  onNavigate?: () => void;
}) {
  const isActive = isLinkActive(link, pathname, all);
  const Icon = NAV_ICONS[link.icon] ?? FileText;
  return (
    <Link
      href={link.href}
      onClick={onNavigate}
      aria-current={pathname === link.href ? "page" : isActive ? "true" : undefined}
      title="Drag onto Pinned to pin it"
      className={itemClass(isActive)}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {link.label}
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
  const { over, error, zone, pinProps } = usePinDrop(
    orgId,
    pins.map((p) => p.id),
  );
  return (
    <div
      {...zone}
      className={cn(
        "-mx-1 flex flex-col rounded-lg px-1 pb-1 transition-colors",
        over && "bg-sidebar-accent/60 ring-sidebar-ring ring-1",
      )}
    >
      <GroupLabel>
        <span className="inline-flex items-center gap-1">
          <Pin className="size-3" aria-hidden="true" />
          Pinned
        </span>
      </GroupLabel>
      {pins.length === 0 ? (
        <p
          className={cn(
            "text-sidebar-foreground/50 mx-1 rounded-md border border-dashed px-2 py-2 text-xs leading-snug",
            over && "border-sidebar-ring text-sidebar-foreground",
          )}
        >
          Drag any page here, or press Pin at the top of a page.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {pins.map((pin) => {
            const Icon = PIN_ICONS[pin.kind] ?? FileText;
            const active = pathname === pin.href;
            return (
              <li key={pin.id} className="group relative" {...pinProps(pin.id)}>
                <Link
                  href={pin.href}
                  onClick={onNavigate}
                  draggable={false}
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
          {over && (
            <li className="text-sidebar-foreground/70 mx-1 rounded-md border border-dashed px-2 py-1.5 text-xs">
              Drop to pin
            </li>
          )}
        </ul>
      )}
      {error && <p className="text-destructive px-3 pt-1 text-xs">{error}</p>}
    </div>
  );
}

export function SidebarNav({
  sections,
  settings,
  orgId,
  pins = [],
  onNavigate,
}: {
  sections: NavSection[];
  settings: NavLink;
  orgId: string;
  pins?: SidebarPin[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const all = [...sections.flatMap((s) => s.items), settings];

  return (
    <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto">
        {sections.map((section) => (
          <div key={section.id} className="flex flex-col gap-0.5">
            {section.label && <GroupLabel>{section.label}</GroupLabel>}
            {section.items.map((link) => (
              <NavItemLink key={link.id} link={link} pathname={pathname} all={all} onNavigate={onNavigate} />
            ))}
          </div>
        ))}
        <PinnedList pins={pins} orgId={orgId} pathname={pathname} onNavigate={onNavigate} />
      </div>
      <div className="border-sidebar-border mt-3 border-t pt-3">
        <NavItemLink link={settings} pathname={pathname} all={all} onNavigate={onNavigate} />
      </div>
    </nav>
  );
}
