"use client";

import { Check, ChevronsUpDown, LogOut, Plus, Settings, ShieldCheck } from "@/components/icons";
import Link from "next/link";
import { useTransition, type ReactNode } from "react";

import { fadeLabel, surfaceTone, useSidebarMode } from "@/components/shell/sidebar-mode-context";
import type { OrgSummary, ShellUser } from "@/components/shell/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/user-avatar";
import { switchActiveOrg } from "@/app/app/actions";
import { cn } from "@/lib/utils";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** The org's logo (64px WebP variant), or its initials. Decorative: the name is always next to it. */
export function OrgMark({
  org,
  className = "size-6",
  tone = "muted",
}: {
  org: OrgSummary;
  className?: string;
  /** Initials on the muted fill, or on the primary (the club tile, like the brand's monogram). */
  tone?: "muted" | "primary";
}) {
  if (org.logoUrl) {
    return (
      // Logos are pre-sized WebP variants in the public store; next/image optimization is not used.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={org.logoUrl}
        alt=""
        aria-hidden="true"
        width={24}
        height={24}
        className={cn("shrink-0 rounded-md object-contain", className)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md text-[10px] font-semibold",
        tone === "primary"
          ? "bg-primary text-primary-foreground font-extrabold"
          : "bg-muted text-muted-foreground",
        className,
      )}
    >
      {initialsOf(org.name)}
    </span>
  );
}

/**
 * Personal and clubs in one list (docs/features/personal-and-clubs.md):
 * the user's Personal space first, then their clubs by name.
 */
export function orderSpaces(orgs: OrgSummary[]): OrgSummary[] {
  const personal = orgs.filter((o) => o.kind === "PERSONAL");
  const clubs = orgs.filter((o) => o.kind !== "PERSONAL");
  return [...personal, ...clubs];
}

/**
 * The menu at the top of the sidebar. Its button is the space you're in:
 * a club's logo and name (as its theme says to show them), or your picture
 * and "Personal". It holds what belongs to the space rather than to a page
 * (the Admin panel and invites for a club's owners and admins, leaving for
 * everyone else; settings for Personal), and switching: Personal first,
 * then your clubs, then Join a club and Start a club.
 */
export function OrgSwitcher({
  orgs,
  activeSlug,
  user,
  brand,
  isAdmin = false,
}: {
  orgs: OrgSummary[];
  activeSlug: string;
  /** The signed-in user: Personal's picture. */
  user?: ShellUser;
  /** The club's logo and name (OrgBrand); falls back to the mark and name. */
  brand?: ReactNode;
  isAdmin?: boolean;
  /** Kept for callers; inviting lives on People now. */
  canInvite?: boolean;
}) {
  const [, startTransition] = useTransition();
  const live = orderSpaces(orgs.filter((o) => !o.pendingDeletion));
  const pending = orgs.filter((o) => o.pendingDeletion);
  const active = live.find((o) => o.slug === activeSlug) ?? live[0] ?? orgs[0];
  const base = `/app/${active.slug}`;
  const personal = active.kind === "PERSONAL";
  const mark = (org: OrgSummary, className: string) =>
    org.kind === "PERSONAL" && user ? (
      <UserAvatar user={user} size={className === "size-8" ? "md" : "xs"} className="shrink-0" />
    ) : (
      <OrgMark org={org} className={className} />
    );
  const nameOf = (org: OrgSummary) => (org.kind === "PERSONAL" ? "Personal" : org.name);
  const clubs = live.filter((o) => o.kind !== "PERSONAL");
  const { rail, chrome, holdPeek } = useSidebarMode();
  const tone = surfaceTone(chrome);

  return (
    <DropdownMenu onOpenChange={holdPeek}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "focus-glow relative flex min-h-9 w-full min-w-0 shrink-0 items-center justify-between gap-2 overflow-hidden py-1.5 text-left outline-none",
            "[transition:border-radius_500ms_var(--ease-ink),padding_500ms_var(--ease-ink),background-color_200ms] motion-reduce:[transition:none]",
            rail ? "rounded-full p-0" : "rounded-lg px-2",
            !rail &&
              (chrome
                ? "aria-expanded:bg-chrome-foreground/10"
                : "aria-expanded:bg-sidebar-accent"),
            !rail && tone.hover,
          )}
          aria-label={`${nameOf(active)} menu`}
        >
          <span className={cn("flex min-w-0 flex-1 items-center gap-2.5", fadeLabel(rail))}>
            {(!personal && brand) || (
              <>
                {mark(active, "size-[22px] rounded-[6px] text-[10px]")}
                <span className="min-w-0 text-[13.5px] leading-tight font-semibold break-words">
                  {nameOf(active)}
                </span>
              </>
            )}
          </span>
          <ChevronsUpDown
            className={cn("size-4 shrink-0 opacity-50", fadeLabel(rail))}
            aria-hidden="true"
          />
          {/* On the rail, the club becomes a circle tile. */}
          <span
            aria-hidden="true"
            className={cn(
              "ring-chrome-foreground/25 pointer-events-none absolute top-1 left-0 grid size-10 place-items-center overflow-hidden rounded-full ring-1",
              "transition-opacity duration-300 motion-reduce:transition-none",
              rail ? "opacity-100 delay-150" : "opacity-0",
            )}
          >
            {personal && user ? (
              <UserAvatar user={user} size="lg" />
            ) : (
              <OrgMark org={active} tone="primary" className="size-10 rounded-full text-xs" />
            )}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {/* The workspace plan's menu: your organizations (the one you're in
            ticked), Personal, then what belongs to the space (Admin panel),
            and one way to join or start another. Invites live on People. */}
        {clubs.map((org) => (
          <DropdownMenuItem
            key={org.slug}
            onSelect={() => startTransition(() => switchActiveOrg(org.slug))}
          >
            <OrgMark org={org} className="size-5" />
            <span className="min-w-0 flex-1 break-words">{org.name}</span>
            {org.slug === active.slug && <Check className="size-4" aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
        {live
          .filter((o) => o.kind === "PERSONAL")
          .map((org) => (
            <DropdownMenuItem
              key={org.slug}
              onSelect={() => startTransition(() => switchActiveOrg(org.slug))}
            >
              {mark(org, "size-5")}
              <span className="flex-1">Personal</span>
              {org.slug === active.slug && <Check className="size-4" aria-hidden="true" />}
            </DropdownMenuItem>
          ))}
        {pending.map((org) => (
          <DropdownMenuItem key={org.slug} asChild>
            <Link href={`/app/${org.slug}`}>
              <OrgMark org={org} className="size-5 opacity-50" />
              <span className="text-muted-foreground min-w-0 flex-1 break-words">
                {nameOf(org)}, scheduled for deletion
              </span>
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {personal ? (
          <DropdownMenuItem asChild>
            <Link href={`${base}/settings`}>
              <Settings className="size-4" aria-hidden="true" />
              Settings
            </Link>
          </DropdownMenuItem>
        ) : isAdmin ? (
          <DropdownMenuItem asChild>
            <Link href={`${base}/settings`}>
              <ShieldCheck className="size-4" aria-hidden="true" />
              Admin panel
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild>
          <Link href="/onboarding/start">
            <Plus className="size-4" aria-hidden="true" />
            Join or create an organization
          </Link>
        </DropdownMenuItem>
        {!personal && !isAdmin && (
          <DropdownMenuItem asChild>
            <Link href={`${base}/settings/members#leave`}>
              <LogOut className="size-4" aria-hidden="true" />
              Leave {active.name}
            </Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
