"use client";

import { LogOut, Monitor, Moon, Sun } from "lucide-react";
import { signOut } from "next-auth/react";
import { useTheme } from "next-themes";

import type { ShellUser } from "@/components/shell/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function UserMenu({ user }: { user: ShellUser }) {
  const displayName = user.name ?? user.email;
  // Each member's Light/Dark/System choice overrides the org's default mode,
  // unless the org locks the mode (Settings > Theme), which next-themes
  // reports as forcedTheme.
  const { setTheme, theme, forcedTheme } = useTheme();
  const locked = Boolean(forcedTheme);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="focus-visible:ring-ring rounded-full focus-visible:ring-2 focus-visible:outline-none"
          aria-label={`Open user menu for ${displayName}`}
        >
          <Avatar>
            {user.image && <AvatarImage src={user.image} alt="" />}
            <AvatarFallback>{initials(displayName)}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col">
          <span className="font-medium">{displayName}</span>
          <span className="text-muted-foreground text-xs font-normal">{user.email}</span>
        </DropdownMenuLabel>
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
