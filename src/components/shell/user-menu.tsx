"use client";

import { LogOut, Monitor, Moon, SlidersHorizontal, Sun, UserRound } from "@/components/icons";
import Link from "next/link";
import { useParams } from "next/navigation";
import { signOut } from "next-auth/react";
import { useTheme } from "next-themes";

import { capsuleButtonClass } from "@/components/shell/capsule";
import { useSidebarEdit } from "@/components/shell/sidebar-edit-context";
import { fadeLabel, surfaceTone, useSidebarMode } from "@/components/shell/sidebar-mode-context";
import type { ShellUser } from "@/components/shell/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/user-avatar";
import { profileHref } from "@/lib/profile/href";
import { cn } from "@/lib/utils";

/**
 * The shell's user menu. `user` comes from the database on every request
 * (getShellUser in the org layout), not from the session token, so a new
 * name or picture shows at once. `avatar` is User.avatar (uploaded
 * variants); UserAvatar falls back to the OAuth image, then initials.
 */
export type UserMenuUser = ShellUser & { avatar?: unknown };

export function UserMenu({
  user,
  variant = "capsule",
  className,
}: {
  user: UserMenuUser;
  /**
   * capsule: a round avatar button; row: a sidebar row (your picture and
   * name), opening upwards (the phone menu's foot); corner: your picture
   * alone beside the organization menu at the top of the sidebar, opening
   * downwards.
   */
  variant?: "capsule" | "row" | "corner";
  className?: string;
}) {
  const displayName = user.name ?? user.email;
  // Each member's Light/Dark/System choice overrides the org's default mode,
  // unless the org locks the mode (Settings > Theme), which next-themes
  // reports as forcedTheme.
  const { setTheme, theme, forcedTheme } = useTheme();
  const locked = Boolean(forcedTheme);
  const params = useParams<{ orgSlug?: string }>();
  const orgSlug = typeof params?.orgSlug === "string" ? params.orgSlug : null;
  const { rail, chrome, holdPeek } = useSidebarMode();
  const tone = surfaceTone(chrome);
  const row = variant === "row";
  const corner = variant === "corner";
  // Edit sidebar lives in your menu beside the sidebar (not the phone's).
  const edit = useSidebarEdit();

  return (
    <DropdownMenu onOpenChange={row || corner ? holdPeek : undefined}>
      <DropdownMenuTrigger asChild>
        {corner ? (
          <button
            type="button"
            title={displayName}
            className={cn(
              "focus-glow grid shrink-0 place-items-center rounded-full outline-none",
              rail ? "size-10" : "size-7",
              "transition-[background-color,scale,width,height] duration-200 active:scale-[0.94] motion-reduce:transition-none",
              tone.hover,
              chrome ? "aria-expanded:bg-chrome-accent/20" : "aria-expanded:bg-brand-accent/15",
              className,
            )}
            aria-label={`Open user menu for ${displayName}`}
          >
            <UserAvatar user={user} size="md" className="size-7 text-xs" />
          </button>
        ) : row ? (
          <button
            type="button"
            title={rail ? displayName : undefined}
            className={cn(
              "focus-glow flex h-8 shrink-0 items-center gap-2 overflow-hidden rounded-[10px] px-1 text-left text-[14.5px] font-medium whitespace-nowrap outline-none",
              "[transition:width_500ms_var(--ease-ink),background-color_200ms] motion-reduce:[transition:none]",
              rail ? "w-8" : "w-full",
              tone.text,
              tone.hover,
              chrome ? "aria-expanded:bg-chrome-accent/20" : "aria-expanded:bg-brand-accent/15",
              className,
            )}
            aria-label={`Open user menu for ${displayName}`}
          >
            <UserAvatar user={user} size="sm" className="shrink-0" />
            <span className={cn("min-w-0 flex-1 truncate", fadeLabel(rail))}>{displayName}</span>
          </button>
        ) : (
          <button
            type="button"
            className={cn(capsuleButtonClass, className)}
            aria-label={`Open user menu for ${displayName}`}
          >
            <UserAvatar user={user} size="md" />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={row ? "start" : "end"}
        side={row ? "top" : "bottom"}
        sideOffset={8}
        className="w-60"
      >
        <DropdownMenuLabel className="flex items-center gap-3">
          <UserAvatar user={user} size="lg" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{displayName}</span>
            <span className="text-muted-foreground truncate text-xs font-normal">{user.email}</span>
          </span>
        </DropdownMenuLabel>
        {orgSlug && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={profileHref(orgSlug)}>
                <UserRound className="size-4" aria-hidden="true" />
                Your profile and settings
              </Link>
            </DropdownMenuItem>
          </>
        )}
        {corner && edit && (
          <DropdownMenuItem onSelect={edit.startEditing}>
            <SlidersHorizontal className="size-4" aria-hidden="true" />
            Edit sidebar
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          {locked ? "Theme (set by your organization)" : "Theme"}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={forcedTheme ?? theme ?? "system"} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light" disabled={locked}>
            <Sun className="size-4" aria-hidden="true" />
            Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark" disabled={locked}>
            <Moon className="size-4" aria-hidden="true" />
            Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system" disabled={locked}>
            <Monitor className="size-4" aria-hidden="true" />
            System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => signOut({ redirectTo: "/" })}>
          <LogOut className="size-4" aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
