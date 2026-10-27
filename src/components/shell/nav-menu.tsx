"use client";

import { FileText, Menu, X } from "@/components/icons";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useState, type ReactNode } from "react";

import { capsuleButtonClass } from "@/components/shell/capsule";
import {
  isExactPage,
  isLinkActive,
  type NavLink,
  type NavSection,
} from "@/components/shell/nav-config";
import { ICON_STROKE, NAV_ICONS } from "@/components/shell/sidebar-nav";
import { segmentedTrack } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

/**
 * The phone's navigation, in place of the sidebar below md: a menu button at
 * the left of the tool capsule opens a full-screen menu over the page. Your
 * club (its menu switches clubs and has the Admin panel) sits at the top,
 * then every section under the sidebar's headings, one roomy row each, the
 * page you're on lit. Going anywhere, Escape or the X closes it.
 */
export function NavMenu({
  sections,
  clubMenu,
}: {
  sections: readonly NavSection[];
  /** The club menu (OrgSwitcher), as the sidebar shows it; it has the Admin panel. */
  clubMenu: ReactNode;
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
              <div className="bg-thumb min-w-0 flex-1 rounded-full px-1 shadow-[0_1px_2px_rgb(0_0_0/0.14),var(--edge-highlight)] [&>button]:h-10 [&>button]:rounded-full">
                {clubMenu}
              </div>
            </div>
          </div>

          <nav aria-label="Sections" className="mt-4 space-y-5">
            {sections.map((section) => {
              const links = section.items.filter((l) => !l.locked);
              if (links.length === 0) return null;
              return (
                <div key={section.id}>
                  {section.label && (
                    <p className="text-muted-foreground px-3 pb-1.5 text-[13px] font-medium">
                      {section.label}
                    </p>
                  )}
                  <ul className="space-y-1">
                    {links.map((link) => (
                      <li key={link.id}>
                        <Row
                          href={link.href}
                          icon={NAV_ICONS[link.icon] ?? FileText}
                          label={link.label}
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
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Row({
  href,
  icon: Icon,
  label,
  current,
  onNavigate,
}: {
  href: string;
  icon: typeof FileText;
  label: string;
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
        // Only the press animates; the selected row lands at once, so a slow
        // page never leaves two rows looking half-selected at the same time.
        "transition-[scale] duration-150 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100",
        "hover:bg-muted aria-[current]:bg-foreground aria-[current]:text-background",
      )}
    >
      <span className="bg-muted group-aria-[current]:bg-background/15 grid size-9 shrink-0 place-items-center rounded-xl">
        <Icon className="size-[18px]" strokeWidth={ICON_STROKE} aria-hidden="true" />
      </span>
      {label}
    </Link>
  );
}
