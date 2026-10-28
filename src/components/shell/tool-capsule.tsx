"use client";

import { Search } from "@/components/icons";

import { useModKey } from "@/components/command-palette/use-mod-key";
import { capsuleButtonClass, CapsuleSeparator } from "@/components/shell/capsule";
import { CreateMenu } from "@/components/shell/create-menu";
import type { CreateAction } from "@/components/shell/nav-config";
import { NotificationBell } from "@/components/shell/notification-bell";
import { PinButton } from "@/components/shell/pin-button";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { UserMenu, type UserMenuUser } from "@/components/shell/user-menu";
import { cn } from "@/lib/utils";

/**
 * The tool capsule: one glass pill at the top right of every page, in place
 * of the old full-width top bar. Search (the ⌘K palette), the + create
 * menu, the page's pin, notifications, light or dark, and you.
 *
 * It floats: its row is sticky and lets clicks through everywhere but the
 * pill, and it takes the same room at the top the old bar did, so every
 * page's title and actions sit below it. On a phone it spans the width with
 * the menu (every section and the club, full screen), search,
 * notifications and you;
 * each page's add button is at its top right, and the user menu has the
 * theme.
 */
export function ToolCapsule({
  orgId,
  orgSlug,
  user,
  createActions,
  onSearch,
  menuButton,
}: {
  orgId: string;
  orgSlug: string;
  user: UserMenuUser;
  createActions: readonly CreateAction[];
  onSearch: () => void;
  /** The phone's menu button (NavMenu), first in the capsule. */
  menuButton?: React.ReactNode;
}) {
  const mod = useModKey();
  return (
    <div className="pointer-events-none sticky top-0 z-30 flex justify-end pt-3 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] md:px-6 md:pt-3.5">
      <div
        role="toolbar"
        aria-label="Tools"
        className="glass-light pointer-events-auto flex max-w-full min-w-0 flex-1 items-center gap-0.5 rounded-full p-1 md:flex-none"
      >
        {menuButton}
        <button
          type="button"
          onClick={onSearch}
          aria-label="Search everything"
          aria-keyshortcuts="Meta+K Control+K"
          className={cn(
            "focus-glow text-muted-foreground flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-full pr-2 pl-3.5 text-sm font-medium outline-none md:flex-none",
            "hover:bg-muted hover:text-foreground transition-[background-color,color,scale] duration-150 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100",
          )}
        >
          <Search className="size-[18px] shrink-0" strokeWidth={1.75} aria-hidden="true" />
          <span className="truncate">Search</span>
          <kbd className="bg-muted text-muted-foreground ms-auto hidden rounded-md px-1.5 py-1 font-mono text-[11px] leading-none md:ms-2 md:block">
            {mod === "⌘" ? "⌘K" : "Ctrl K"}
          </kbd>
        </button>
        <CapsuleSeparator className="max-md:hidden" />
        {createActions.length > 0 && (
          <CreateMenu orgId={orgId} orgSlug={orgSlug} actions={createActions}>
            {({ pending, icon }) => (
              <button
                type="button"
                aria-label="Create"
                title="Create"
                aria-busy={pending || undefined}
                className={cn(capsuleButtonClass, "max-md:hidden")}
              >
                {icon}
              </button>
            )}
          </CreateMenu>
        )}
        <PinButton className={cn(capsuleButtonClass, "max-md:hidden")} />
        <NotificationBell />
        <ThemeToggle className="max-md:hidden" />
        <CapsuleSeparator className="max-md:hidden" />
        <UserMenu user={user} />
      </div>
    </div>
  );
}
