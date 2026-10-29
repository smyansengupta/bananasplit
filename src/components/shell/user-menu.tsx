"use client";

import { LogOut, Monitor, Moon, Sun, UserRound } from "@/components/icons";
import Link from "next/link";
import { useParams } from "next/navigation";
import { signOut } from "next-auth/react";
import { useTheme } from "next-themes";

import { capsuleButtonClass } from "@/components/shell/capsule";
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

export function UserMenu({ user, className }: { user: UserMenuUser; className?: string }) {
  const displayName = user.name ?? user.email;
  // Each member's Light/Dark/System choice overrides the org's default mode,
  // unless the org locks the mode (Settings > Theme), which next-themes
  // reports as forcedTheme.
  const { setTheme, theme, forcedTheme } = useTheme();
  const locked = Boolean(forcedTheme);
  const params = useParams<{ orgSlug?: string }>();
  const orgSlug = typeof params?.orgSlug === "string" ? params.orgSlug : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(capsuleButtonClass, className)}
          aria-label={`Open user menu for ${displayName}`}
        >
          <UserAvatar user={user} size="md" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-60">
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
