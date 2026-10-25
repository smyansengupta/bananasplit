"use client";

import { useEffect, useState } from "react";

import { Search, Video } from "@/components/icons";
import { useModKey } from "@/components/command-palette/use-mod-key";
import { capsuleButtonClass, CapsuleSeparator } from "@/components/shell/capsule";
import { CreateMenu } from "@/components/shell/create-menu";
import type { CreateAction } from "@/components/shell/nav-config";
import { NotificationBell } from "@/components/shell/notification-bell";
import { PinButton } from "@/components/shell/pin-button";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { UserMenu, type UserMenuUser } from "@/components/shell/user-menu";
import type { CapsuleVariant } from "@/lib/shell/capsule-variant";
import { cn } from "@/lib/utils";

/**
 * Three shapes for the floating bar, to pick between
 * (docs/features/tool-capsule.md).
 *
 * The complaint was that it is not useful: six controls that sit there
 * whatever is going on. Search is the only one you reach for, and it is a
 * button that opens a palette rather than somewhere to type. So each of these
 * tries a different answer to "what should a bar that is always on screen be
 * doing?".
 *
 * They share every control; only the shape and what leads differs. Whichever
 * wins, the other two go.
 */

export interface CapsuleProps {
  orgId: string;
  orgSlug: string;
  user: UserMenuUser;
  createActions: readonly CreateAction[];
  onSearch: () => void;
  menuButton?: React.ReactNode;
  /** The next thing happening, for the variant that leads with it. */
  next?: CapsuleNext | null;
}

export interface CapsuleNext {
  title: string;
  /** When it starts, as an instant. */
  startsAt: string;
  href: string;
  /** A join link, when it is an online meeting. */
  joinUrl: string | null;
}

/** "in 20 min", "in 2 hours", "tomorrow" - short enough for a pill. */
function whenShort(startsAt: string, now: number): string {
  const ms = Date.parse(startsAt) - now;
  if (Number.isNaN(ms)) return "";
  const mins = Math.round(ms / 60_000);
  if (mins <= 0) return "now";
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.round(hours / 24);
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

/** Re-renders once a minute, so "in 20 min" does not go stale on screen. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

const SHELL =
  "glass-light pointer-events-auto flex max-w-full min-w-0 items-center gap-0.5 rounded-full p-1";

/**
 * A: the command bar. The pill IS the search field, wide enough to read a
 * query in, with everything else pushed to the right of it. The bet: the one
 * control anyone wants should look like what it is, not like a button that
 * opens the thing you wanted.
 */
export function CommandBarCapsule({
  orgId,
  orgSlug,
  user,
  createActions,
  onSearch,
  menuButton,
}: CapsuleProps) {
  const mod = useModKey();
  return (
    <div role="toolbar" aria-label="Tools" className={cn(SHELL, "md:w-[30rem]")}>
      {menuButton}
      <button
        type="button"
        onClick={onSearch}
        aria-label="Search everything"
        aria-keyshortcuts="Meta+K Control+K"
        className={cn(
          "focus-glow text-muted-foreground bg-muted/50 hover:bg-muted flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-full pr-2 pl-3.5 text-sm font-medium outline-none",
          "transition-[background-color,color] duration-150",
        )}
      >
        <Search className="size-[18px] shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <span className="truncate">Search tasks, people, files…</span>
        <kbd className="bg-background text-muted-foreground ms-auto hidden rounded-md px-1.5 py-1 font-mono text-[11px] leading-none md:block">
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
      <UserMenu user={user} />
    </div>
  );
}

/**
 * B: the context bar. It leads with the thing that is about to happen and the
 * one button you want for it - Join, for a meeting starting in twenty
 * minutes - and falls back to the plain search pill when nothing is coming.
 * The bet: a bar that is always there should say something that changes.
 */
export function ContextBarCapsule({
  orgId,
  orgSlug,
  user,
  createActions,
  onSearch,
  menuButton,
  next,
}: CapsuleProps) {
  const now = useNow(Boolean(next));
  const when = next ? whenShort(next.startsAt, now) : "";

  return (
    <div role="toolbar" aria-label="Tools" className={SHELL}>
      {menuButton}

      {next ? (
        <div className="flex min-w-0 items-center gap-1.5 pr-1 pl-2.5">
          <a
            href={next.href}
            className="focus-glow flex min-w-0 flex-col rounded-md px-1 py-0.5 text-left outline-none"
          >
            <span className="truncate text-sm leading-tight font-medium">{next.title}</span>
            <span className="text-muted-foreground truncate text-[11px] leading-tight">{when}</span>
          </a>
          {next.joinUrl && (
            <a
              href={next.joinUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="bg-primary text-primary-foreground focus-glow inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium outline-none transition-transform active:scale-[0.97]"
            >
              <Video className="size-3.5" aria-hidden="true" />
              Join
            </a>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={onSearch}
          aria-label="Search everything"
          className={cn(
            "focus-glow text-muted-foreground hover:bg-muted hover:text-foreground flex h-10 items-center gap-2.5 rounded-full pr-2 pl-3.5 text-sm font-medium outline-none transition-colors",
          )}
        >
          <Search className="size-[18px] shrink-0" strokeWidth={1.75} aria-hidden="true" />
          <span className="truncate">Search</span>
        </button>
      )}

      <CapsuleSeparator className="max-md:hidden" />
      {next && (
        <button
          type="button"
          onClick={onSearch}
          aria-label="Search everything"
          className={cn(capsuleButtonClass, "max-md:hidden")}
        >
          <Search className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
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
      <NotificationBell />
      <UserMenu user={user} />
    </div>
  );
}

/**
 * C: the quiet bar. As little as can carry its job - search, what needs you,
 * and you - with the create menu, the pin and the theme moved into the user
 * menu. The bet: a floating thing should take the least room it can, and
 * everything it was holding is one keystroke or one menu away.
 */
export function QuietCapsule({ user, onSearch, menuButton }: CapsuleProps) {
  const mod = useModKey();
  return (
    <div role="toolbar" aria-label="Tools" className={SHELL}>
      {menuButton}
      <button
        type="button"
        onClick={onSearch}
        aria-label="Search everything"
        aria-keyshortcuts="Meta+K Control+K"
        title={`Search (${mod === "⌘" ? "⌘K" : "Ctrl K"})`}
        className={capsuleButtonClass}
      >
        <Search className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
      </button>
      <NotificationBell />
      <ThemeToggle className="max-md:hidden" />
      <UserMenu user={user} />
    </div>
  );
}

export const CAPSULE_VARIANTS: Record<
  CapsuleVariant,
  ((props: CapsuleProps) => React.ReactElement) | null
> = {
  /** What ships today (tool-capsule.tsx draws it). */
  current: null,
  command: CommandBarCapsule,
  context: ContextBarCapsule,
  quiet: QuietCapsule,
};
