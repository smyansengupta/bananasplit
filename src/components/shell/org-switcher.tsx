"use client";

import { Check, ChevronsUpDown, Plus } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";

import type { OrgSummary } from "@/components/shell/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { switchActiveOrg } from "@/app/app/actions";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** The org's logo (64px WebP variant), or its initials. Decorative: the name is always next to it. */
export function OrgMark({ org, className = "size-6" }: { org: OrgSummary; className?: string }) {
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
        className={`${className} shrink-0 rounded object-contain`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`${className} bg-muted text-muted-foreground inline-flex shrink-0 items-center justify-center rounded text-[10px] font-semibold`}
    >
      {initialsOf(org.name)}
    </span>
  );
}

export function OrgSwitcher({ orgs, activeSlug }: { orgs: OrgSummary[]; activeSlug: string }) {
  const [, startTransition] = useTransition();
  const live = orgs.filter((o) => !o.pendingDeletion);
  const pending = orgs.filter((o) => o.pendingDeletion);
  const active = live.find((o) => o.slug === activeSlug) ?? live[0] ?? orgs[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-between gap-2"
          aria-label={`Switch organization, current: ${active.name}`}
        >
          <span className="flex min-w-0 items-center gap-2">
            <OrgMark org={active} className="size-5" />
            <span className="truncate">{active.name}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        {live.map((org) => (
          <DropdownMenuItem
            key={org.slug}
            onSelect={() => startTransition(() => switchActiveOrg(org.slug))}
          >
            <OrgMark org={org} className="size-5" />
            <span className="flex-1 truncate">{org.name}</span>
            {org.slug === active.slug && <Check className="size-4" aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
        {pending.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
              Scheduled for deletion
            </DropdownMenuLabel>
            {pending.map((org) => (
              <DropdownMenuItem key={org.slug} asChild>
                <Link href={`/app/${org.slug}`}>
                  <OrgMark org={org} className="size-5 opacity-50" />
                  <span className="text-muted-foreground flex-1 truncate">{org.name}</span>
                </Link>
              </DropdownMenuItem>
            ))}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/app/new">
            <Plus className="size-4" aria-hidden="true" />
            Create organization
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
