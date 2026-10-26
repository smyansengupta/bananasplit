"use client";

import { Building2, Check, LayoutGrid, Lock, Menu, type IconComponent } from "@/components/icons";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { chipClass, segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

import { SETTINGS_ICONS } from "./settings-icons";
import { isSettingsItemActive, SETTINGS_GROUPS, type SettingsNavItem } from "./settings-nav";

/** A section the club's plan doesn't include (its page offers the upgrade). */
function LockMark({ locked }: { locked?: boolean }) {
  if (!locked) return null;
  return (
    <>
      <Lock className="ms-auto size-3.5 shrink-0 opacity-60" aria-hidden="true" />
      <span className="sr-only"> (not on your plan)</span>
    </>
  );
}

/** One row of the list: icon and name, a filled pill when it's the open page. */
function NavRow({
  href,
  label,
  icon: Icon,
  active,
  current,
  locked,
}: {
  href: string;
  label: string;
  icon: IconComponent;
  active: boolean;
  /** aria-current: "page" on the item's own URL, "true" on a page below it. */
  current?: "page" | "true";
  locked?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={current}
      className={cn(
        "rounded-field focus-visible:outline-foreground flex h-10 items-center gap-3 px-3 text-sm transition-colors outline-none focus-visible:outline-2 focus-visible:-outline-offset-2",
        active
          ? "bg-muted text-foreground font-semibold"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground font-medium",
      )}
    >
      <Icon className="size-[18px] shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">{label}</span>
      <LockMark locked={locked} />
    </Link>
  );
}

/**
 * Admin panel navigation: a grouped list in a card beside the page on wide
 * screens (the open page a filled pill), a scrolling strip of pills on a
 * tablet, and on a phone the open page with a menu button beside it that
 * drops down every page under its group (as Finance's tabs do there).
 */
export function SettingsSubnav({
  items,
  orgSlug,
  personal = false,
}: {
  items: SettingsNavItem[];
  orgSlug: string;
  /** A Personal space: the overview is "Settings", not "Admin panel". */
  personal?: boolean;
}) {
  const pathname = usePathname() ?? "";
  const overview = `/app/${orgSlug}/settings`;
  const onOverview = pathname === overview;

  const activeItem = items.find((item) => isSettingsItemActive(item, pathname));
  const CurrentIcon = onOverview
    ? LayoutGrid
    : activeItem
      ? (SETTINGS_ICONS[activeItem.icon] ?? Building2)
      : LayoutGrid;
  const currentLabel = onOverview
    ? personal
      ? "Settings"
      : "Overview"
    : (activeItem?.label ?? (personal ? "Settings" : "Admin panel"));

  return (
    <nav aria-label="Admin panel">
      {/* Phone: the open page, and a menu of the rest. */}
      <div className="flex items-center gap-2 md:hidden">
        <span className={cn(segmentedTrack, "min-w-0 flex-1")}>
          <span className={cn(segmentedItem(true), "w-full min-w-0 justify-center")}>
            <CurrentIcon aria-hidden="true" />
            <span className="truncate">{currentLabel}</span>
          </span>
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="shrink-0"
              aria-label="Admin panel: other pages"
            >
              <Menu className="size-[18px]" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[70svh] w-64 overflow-y-auto">
            <DropdownMenuItem asChild>
              <Link href={overview} aria-current={onOverview ? "page" : undefined}>
                <LayoutGrid className="size-4" aria-hidden="true" />
                {personal ? "Settings" : "Overview"}
                {onOverview && <Check className="ms-auto size-4" aria-hidden="true" />}
              </Link>
            </DropdownMenuItem>
            {SETTINGS_GROUPS.map((group) => {
              const groupItems = items.filter((i) => i.group === group);
              if (groupItems.length === 0) return null;
              return (
                <div key={group}>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                    {group}
                  </DropdownMenuLabel>
                  {groupItems.map((item) => {
                    const active = isSettingsItemActive(item, pathname);
                    const Icon = SETTINGS_ICONS[item.icon] ?? Building2;
                    return (
                      <DropdownMenuItem key={item.href} asChild>
                        <Link href={item.href} aria-current={active ? "page" : undefined}>
                          <Icon className="size-4" aria-hidden="true" />
                          {item.label}
                          {item.locked && (
                            <Lock className="ms-auto size-3.5 opacity-60" aria-hidden="true" />
                          )}
                          {active && <Check className="ms-auto size-4" aria-hidden="true" />}
                        </Link>
                      </DropdownMenuItem>
                    );
                  })}
                </div>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Tablet: one scrolling row of pills, the open page filled. */}
      <div className="-mx-4 [scrollbar-width:none] overflow-x-auto px-4 pb-1 max-md:hidden lg:hidden">
        <ul className="flex min-w-max gap-2">
          <li>
            <Link
              href={overview}
              aria-current={onOverview ? "page" : undefined}
              className={chipClass(onOverview)}
            >
              <LayoutGrid aria-hidden="true" />
              Overview
            </Link>
          </li>
          {items.map((item) => {
            const active = isSettingsItemActive(item, pathname);
            const Icon = SETTINGS_ICONS[item.icon] ?? Building2;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={chipClass(active)}
                >
                  <Icon aria-hidden="true" />
                  {item.label}
                  <LockMark locked={item.locked} />
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Wide screens: the grouped list in a card. */}
      <Card className="hidden gap-4 p-3 lg:flex">
        <NavRow
          href={overview}
          label={personal ? "Settings" : "Overview"}
          icon={LayoutGrid}
          active={onOverview}
          current={onOverview ? "page" : undefined}
        />
        {SETTINGS_GROUPS.map((group) => {
          const groupItems = items.filter((i) => i.group === group);
          if (groupItems.length === 0) return null;
          return (
            <div key={group} className="space-y-0.5">
              <p className="eyebrow text-muted-foreground px-3 pb-1">{group}</p>
              {groupItems.map((item) => {
                const active = isSettingsItemActive(item, pathname);
                return (
                  <NavRow
                    key={item.href}
                    href={item.href}
                    label={item.label}
                    icon={SETTINGS_ICONS[item.icon] ?? Building2}
                    active={active}
                    current={pathname === item.href ? "page" : active ? "true" : undefined}
                    locked={item.locked}
                  />
                );
              })}
            </div>
          );
        })}
      </Card>
    </nav>
  );
}
