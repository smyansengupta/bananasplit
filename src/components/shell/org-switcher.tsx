"use client";

import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MockOrg } from "@/lib/shell-mock-data";

export function OrgSwitcher({ orgs, activeSlug }: { orgs: MockOrg[]; activeSlug: string }) {
  const router = useRouter();
  const active = orgs.find((o) => o.slug === activeSlug) ?? orgs[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-between"
          aria-label={`Switch organization, current: ${active.name}`}
        >
          <span className="truncate">{active.name}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {orgs.map((org) => (
          <DropdownMenuItem key={org.slug} onSelect={() => router.push(`/app/${org.slug}`)}>
            <span className="flex-1 truncate">{org.name}</span>
            {org.slug === active.slug && <Check className="size-4" aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <Plus className="size-4" aria-hidden="true" />
          Create organization
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
