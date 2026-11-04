"use client";

import { FileText, Menu, Plus, Search, X } from "@/components/icons";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useState, type ReactNode } from "react";

import { Logo } from "@/components/brand/logo";
import { capsuleButtonClass } from "@/components/shell/capsule";
import { CreateMenu } from "@/components/shell/create-menu";
import {
  isExactPage,
  isLinkActive,
  type CreateAction,
  type NavLink,
  type NavSection,
} from "@/components/shell/nav-config";
import { ICON_STROKE, NAV_ICONS, SECTION_NAMES } from "@/components/shell/sidebar-nav";
import type { ShellUser } from "@/components/shell/types";
import { UserMenu } from "@/components/shell/user-menu";
import { segmentedTrack } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

/**
 * The phone's navigation, in place of the sidebar below md: a menu button at
 * the left of the tool capsule opens a full-screen menu over the page, in
 * the sidebar's order. Your organization (its menu switches spaces and has
 * the Admin panel) sits at the top, then New and Search or jump under it,
 * then every section in its group (a thin line between groups), one roomy
 * row each, the page you're on lit, then you (your menu) and the
 * Bananasplit mark last. Going anywhere, Escape or the X closes it.
 */
export function NavMenu({
  sections,
  clubMenu,
  user,
  counts = {},
  orgId,
  orgSlug,
  createActions = [],
  onSearch,
}: {
  sections: readonly NavSection[];
  /** The organization menu (OrgSwitcher), as the sidebar shows it; it has the Admin panel. */
  clubMenu: ReactNode;
  /** You, at the foot: your picture and name, opening your menu. */
  user?: ShellUser;
  counts?: Record<string, number>;
  orgId: string;
  orgSlug: string;
  createActions?: readonly CreateAction[];
  onSearch: () => void;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const all = sections.flatMap((s) => s.items);
  const close = () => setOpen(false);

  const current = (link: NavLink) =>
    isExactPage(link.href, pathname, search)
      ? "page"
      : isLinkActive(link, pathname, all, search)
        ? "true"
        : undefined;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <button type="button" aria-label="Menu" className={cn(capsuleButtonClass, "md:hidden")}>
          <Menu className="size-5" strokeWidth={ICON_STROKE} aria-hidden="true" />
        </button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "bg-background/95 text-foreground fixed inset-0 z-50 flex flex-col overflow-y-auto backdrop-blur-xl outline-none md:hidden",
            "pt-[max(0.75rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1.5rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]",
            "data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-top-2 data-closed:animate-out data-closed:fade-out-0 duration-200",
          )}
        >
          <DialogPrimitive.Title className="sr-only">Menu</DialogPrimitive.Title>
          {/* The X where the menu button was, then the club. */}
          <div className="flex items-center gap-2">
            <DialogPrimitive.Close asChild>
              {/* Its own circle, in the club track's grey. */}
              <button
                type="button"
                aria-label="Close menu"
                className={cn(capsuleButtonClass, "bg-muted hover:bg-muted size-12")}
              >
                <X className="size-5" strokeWidth={ICON_STROKE} aria-hidden="true" />
              </button>
            </DialogPrimitive.Close>
            {/* The club as the switch bar's track and thumb (People › Directory, Org chart). */}
            <div className={cn(segmentedTrack, "h-auto min-w-0 flex-1")}>
              <div className="bg-thumb min-w-0 flex-1 rounded-full px-1 shadow-[0_1px_2px_rgb(0_0_0/0.14),var(--edge-highlight)] [&>button]:min-h-10 [&>button]:rounded-full">
                {clubMenu}
              </div>
            </div>
          </div>

          {/* New, then Search or jump under it: the sidebar's own two, under the organization. */}
          <div className="mt-3 flex shrink-0 flex-col gap-2">
            {createActions.length > 0 && (
              <CreateMenu orgId={orgId} orgSlug={orgSlug} actions={createActions} align="start">
                {({ pending, icon }) => (
                  <button
                    type="button"
                    aria-busy={pending || undefined}
                    className="focus-glow bg-primary text-primary-foreground flex h-12 w-full shrink-0 items-center gap-2 rounded-2xl px-4 text-[15px] font-semibold outline-none"
                  >
                    {pending ? icon : <Plus className="size-5" aria-hidden="true" />}
                    New
                  </button>
                )}
              </CreateMenu>
            )}
            <button
              type="button"
              onClick={() => {
                close();
                onSearch();
              }}
              className="focus-glow bg-muted text-muted-foreground flex h-12 w-full min-w-0 items-center gap-2.5 rounded-2xl px-4 text-[15px] outline-none"
            >
              <Search className="size-5 shrink-0" strokeWidth={ICON_STROKE} aria-hidden="true" />
              Search or jump
            </button>
          </div>

          <nav aria-label="Sections" className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
            {sections.map((section, i) => {
              const links = section.items.filter((l) => !l.locked);
              if (links.length === 0) return null;
              const name = section.label ?? SECTION_NAMES[section.id];
              return (
                // Named sections with room above them, as in the sidebar.
                <div key={section.id} className={cn(i > 0 && "mt-5")}>
                  {name && (
                    <p className="text-muted-foreground mb-1 px-3 text-[13px] font-medium">
                      {name}
                    </p>
                  )}
                  <ul className="space-y-1">
                    {links.map((link) => (
                      <li key={link.id}>
                        <Row
                          href={link.href}
                          icon={NAV_ICONS[link.icon] ?? FileText}
                          label={link.label}
                          count={counts[link.id] ?? 0}
                          current={current(link)}
                          onNavigate={close}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </nav>

          {/* The foot, as in the sidebar: you, then the Bananasplit mark. */}
          <div className="mt-4 flex shrink-0 flex-col gap-3 pt-1">
            {user && <UserMenu user={user} variant="row" className="h-12 text-[15px]" />}
            <Link
              href="/"
              onClick={close}
              className="focus-glow flex w-fit items-center rounded-full px-1.5 outline-none"
            >
              <Logo size={22} textSize={17} className="gap-2" />
            </Link>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Row({
  href,
  icon: Icon,
  label,
  count = 0,
  current,
  onNavigate,
}: {
  href: string;
  icon: typeof FileText;
  label: string;
  count?: number;
  current: "page" | "true" | undefined;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={current}
      className={cn(
        "focus-glow group flex h-12 items-center gap-3 rounded-2xl px-2 text-[15px] font-medium outline-none",
        "transition-[background-color,scale] duration-150 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100",
        "hover:bg-brand-accent/15 aria-[current]:bg-brand-accent aria-[current]:text-brand-accent-foreground",
      )}
    >
      <span className="bg-muted group-aria-[current]:bg-brand-accent-foreground/15 grid size-9 shrink-0 place-items-center rounded-xl">
        <Icon className="size-[18px]" strokeWidth={ICON_STROKE} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">{label}</span>
      {count > 0 && (
        <span className="bg-muted group-aria-[current]:bg-brand-accent-foreground/15 shrink-0 rounded-full px-2 text-[13px] leading-6 font-semibold tabular-nums">
          {count > 99 ? "99+" : count}
          <span className="sr-only"> waiting</span>
        </span>
      )}
    </Link>
  );
}
