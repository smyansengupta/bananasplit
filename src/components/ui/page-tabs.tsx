"use client";

import { type IconComponent } from "@/components/icons";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { SegmentCount, segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

/**
 * The one way a section splits into pages (Finance's pages, Databases and
 * Reports, People's directory and org chart): the same switch bar Tasks uses
 * for its layouts, so every set of tabs in the app looks and works alike.
 * A tab is active on its own URL, or on anything below it unless `exact`;
 * pass `active` to decide yourself.
 *
 * On a phone the bar spans the width and the tabs share it. When there are
 * too many to fit (Finance's five), the bar scrolls sideways instead of
 * hiding the rest behind a menu: every tab stays one tap away, and the one
 * you're on is scrolled into view.
 */

export interface PageTab {
  href: string;
  label: string;
  icon?: IconComponent;
  exact?: boolean;
  active?: boolean;
  /** How many are waiting there (a badge after the label; none at 0). */
  count?: number;
  /**
   * Fetch the whole page once the pointer is on the tab, so the click finds it
   * here. The page renders for that, so never a page that writes on a visit.
   * It's kept 30 seconds at most (staleTimes in next.config.ts).
   */
  warm?: boolean;
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
  // The one tab the pointer has reached; the rest prefetch as they always have.
  const [hovered, setHovered] = useState<string | null>(null);
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

  return (
    <>
      <nav
        aria-label={label}
        className={cn("max-w-full [scrollbar-width:none] overflow-x-auto", className)}
      >
        <ul className={cn(segmentedTrack, "min-w-max max-md:flex max-md:w-max max-md:min-w-full")}>
          {tabs.map((tab) => {
            const active = isActive(tab);
            const Icon = tab.icon;
            return (
              <li key={tab.href} className="max-md:flex-auto">
                <Link
                  href={tab.href}
                  prefetch={tab.warm && !active && hovered === tab.href ? true : undefined}
                  onPointerEnter={tab.warm ? () => setHovered(tab.href) : undefined}
                  aria-current={active ? "page" : undefined}
                  ref={
                    active
                      ? (el) => el?.scrollIntoView({ block: "nearest", inline: "nearest" })
                      : undefined
                  }
                  className={cn(segmentedItem(active), "max-md:w-full max-md:justify-center")}
                >
                  {Icon && <Icon aria-hidden="true" />}
                  {tab.label}
                  {tab.count ? <SegmentCount n={tab.count} active={active} /> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
