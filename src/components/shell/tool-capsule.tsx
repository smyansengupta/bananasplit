"use client";

import { capsuleButtonClass } from "@/components/shell/capsule";
import { NotificationBell } from "@/components/shell/notification-bell";
import { PinButton } from "@/components/shell/pin-button";
import { UserMenu, type UserMenuUser } from "@/components/shell/user-menu";
import { cn } from "@/lib/utils";

/**
 * The tool capsule: one glass pill at the top right of every page, with the
 * page's pin, notifications (the Inbox) and you. Search and New live at the
 * top of the sidebar (sidebar-tools.tsx), so they aren't repeated here; on a
 * phone, the menu button opens them with every section.
 *
 * It floats: its row is sticky and lets clicks through everywhere but the
 * pill, and it takes the same room at the top the old bar did, so every
 * page's title and actions sit below it. On a phone it spans the width with
 * the menu (the organization, search, New and every section, full screen),
 * notifications and you.
 */
export function ToolCapsule({
  orgSlug,
  user,
  menuButton,
}: {
  orgSlug: string;
  user: UserMenuUser;
  /** The phone's menu button (NavMenu), first in the capsule. */
  menuButton?: React.ReactNode;
}) {
  return (
    <div className="pointer-events-none sticky top-0 z-30 flex justify-end pt-3 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] md:px-6 md:pt-3.5">
      <div
        role="toolbar"
        aria-label="Tools"
        className="glass-light pointer-events-auto flex max-w-full min-w-0 items-center gap-0.5 rounded-full p-1 max-md:flex-1"
      >
        {menuButton}
        <span className="flex-1 md:hidden" />
        <PinButton className={cn(capsuleButtonClass, "max-md:hidden")} />
        <NotificationBell href={`/app/${orgSlug}/inbox`} />
        <UserMenu user={user} />
      </div>
    </div>
  );
}
