"use client";

import { LogOut, Monitor, Moon, Sun, UserRound, Users } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { signOut } from "next-auth/react";
import { useTheme } from "next-themes";

import type { ShellUser } from "@/components/shell/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/user-avatar";
import { peopleHref, profileHref } from "@/lib/profile/href";

/**
 * The shell's user menu. `user` comes from the database on every request
 * (getShellUser in the org layout), not from the session token, so a new
 * name or picture shows at once. `avatar` is User.avatar (uploaded
 * variants); UserAvatar falls back to the OAuth image, then initials.
 */
export type UserMenuUser = ShellUser & { avatar?: unknown };

export function UserMenu({ user }: { user: UserMenuUser }) {
  const displayName = user.name ?? user.email;
  const { setTheme } = useTheme();
  const params = useParams<{ orgSlug?: string }>();
  const orgSlug = typeof params?.orgSlug === "string" ? params.orgSlug : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="focus-visible:ring-ring rounded-full focus-visible:ring-2 focus-visible:outline-none"
          aria-label={`Open user menu for ${displayName}`}
        >
          <UserAvatar user={user} size="md" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
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
                Your profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={peopleHref(orgSlug)}>
                <Users className="size-4" aria-hidden="true" />
                People
              </Link>
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          Theme
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => setTheme("light")}>
          <Sun className="size-4" aria-hidden="true" />
          Light
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme("dark")}>
          <Moon className="size-4" aria-hidden="true" />
          Dark
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme("system")}>
          <Monitor className="size-4" aria-hidden="true" />
          System
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => signOut({ redirectTo: "/" })}>
          <LogOut className="size-4" aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
