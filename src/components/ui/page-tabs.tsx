"use client";

import { Check, Menu, type IconComponent } from "@/components/icons";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

/**
 * The one way a section splits into pages (Finance's pages, Databases and
 * Reports, People's directory and org chart): the same switch bar Tasks uses
 * for its layouts, so every set of tabs in the app looks and works alike.
 * A tab is active on its own URL, or on anything below it unless `exact`;
 * pass `active` to decide yourself.
 *
 * On a phone the bar spans the width and the tabs share it. More than three
 * (Finance's five) don't fit, so there it shows the one you're on, with a
 * menu button beside it that drops down the others.
 */
/** More than this many tabs fold into the current one and a menu on a phone. */
const PHONE_MAX_TABS = 3;

export interface PageTab {
  href: string;
  label: string;
  icon?: IconComponent;
  exact?: boolean;
  active?: boolean;
}

export function PageTabs({
  tabs,
  label,
  className,
}: {
  tabs: readonly PageTab[];
  label: string;
  className?: string;
}) {
  const pathname = usePathname() ?? "";
  const isActive = (t: PageTab) => {
    if (t.active !== undefined) return t.active;
    if (pathname === t.href) return true;
    if (t.exact) return false;
    // The most specific tab wins (Dashboard at /finance vs /finance/budget).
    return (
      pathname.startsWith(`${t.href}/`) &&
      !tabs.some(
        (o) =>
          o.href.length > t.href.length &&
          (pathname === o.href || pathname.startsWith(`${o.href}/`)),
      )
    );
  };

  const many = tabs.length > PHONE_MAX_TABS;
  // On a page none of the tabs is (Finance › Import), the pill names the section.
  const current = tabs.find(isActive);
  const CurrentIcon = current?.icon;

  return (
    <>
      {many && (
        <nav aria-label={label} className={cn("flex items-center gap-2 md:hidden", className)}>
          <span className={cn(segmentedTrack, "min-w-0 flex-1")}>
            {current ? (
              <Link
                href={current.href}
                aria-current="page"
                className={cn(segmentedItem(true), "w-full min-w-0 justify-center")}
              >
                {CurrentIcon && <CurrentIcon aria-hidden="true" />}
                <span className="truncate">{current.label}</span>
              </Link>
            ) : (
              <span className={cn(segmentedItem(false), "w-full min-w-0 justify-center")}>
                <span className="truncate">{label}</span>
              </span>
            )}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="shrink-0"
                aria-label={`${label}: other pages`}
              >
                <Menu className="size-[18px]" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const active = tab === current;
                return (
                  <DropdownMenuItem key={tab.href} asChild>
                    <Link href={tab.href} aria-current={active ? "page" : undefined}>
                      {Icon && <Icon className="size-4" aria-hidden="true" />}
                      {tab.label}
                      {active && <Check className="ms-auto size-4" aria-hidden="true" />}
                    </Link>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>
      )}
      <nav
        aria-label={label}
        className={cn("max-w-full overflow-x-auto", many && "max-md:hidden", className)}
      >
        <ul
          className={cn(
            segmentedTrack,
            "min-w-max max-md:flex max-md:h-auto max-md:w-full max-md:min-w-0 max-md:flex-wrap max-md:rounded-[22px]",
          )}
        >
          {tabs.map((tab) => {
            const active = isActive(tab);
            const Icon = tab.icon;
            return (
              <li key={tab.href} className="max-md:flex-auto">
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(segmentedItem(active), "max-md:w-full max-md:justify-center")}
                >
                  {Icon && <Icon aria-hidden="true" />}
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
