"use client";

import { Building2, Lock, type IconComponent } from "@/components/icons";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Card } from "@/components/ui/card";
import { chipClass } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

import { SETTINGS_ICONS } from "./settings-icons";
import { isSettingsItemActive, type SettingsNavItem } from "./settings-nav";

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
        "rounded-field focus-visible:outline-foreground flex min-h-10 items-center gap-3 px-3 py-2 text-sm transition-colors outline-none focus-visible:outline-2 focus-visible:-outline-offset-2",
        active
          ? "bg-muted text-foreground font-semibold"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground font-medium",
      )}
    >
      <Icon className="size-[18px] shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">{label}</span>
      <LockMark locked={locked} />
    </Link>
  );
}

/**
 * Admin panel navigation: one flat list in a card beside the page on wide
 * screens (the open page a filled pill), and below that a single scrolling
 * strip of pills, phones included, so every page is one tap away. There is
 * no overview page: the panel opens on General.
 */
export function SettingsSubnav({ items }: { items: SettingsNavItem[] }) {
  const pathname = usePathname() ?? "";

  return (
    <nav aria-label="Admin panel">
      {/* Phones and tablets: one scrolling row of pills, the open page filled. */}
      <div className="-mx-4 [scrollbar-width:none] overflow-x-auto px-4 pb-1 lg:hidden">
        <ul className="flex min-w-max gap-2">
          {items.map((item) => {
            const active = isSettingsItemActive(item, pathname);
            const Icon = SETTINGS_ICONS[item.icon] ?? Building2;
            return (
              <li key={item.href}>
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
                  <LockMark locked={item.locked} />
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Wide screens: the list in a card. */}
      <Card className="hidden gap-0.5 p-3 lg:flex">
        {items.map((item) => {
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
      </Card>
    </nav>
  );
}
