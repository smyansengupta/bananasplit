"use client";

import { Building2, Columns3, FileSpreadsheet, Settings, UserPlus } from "@/components/icons";
import Link from "next/link";
import type { ReactNode } from "react";

import { useCrmOpen } from "@/components/crm/card/use-crm-open";
import { PHONE_SMALL_CREATE } from "@/components/page-header";
import { CreateSplitButton } from "@/components/ui/create-split-button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * The CRM's header row, the same on every tab, laid out like Tasks': the
 * title, then the one create (New person, with New company, New deal and
 * Import a spreadsheet in its menu) and, right of it, the round settings
 * button for whoever may change the CRM. Creating opens a card over the
 * page (?open=new:...), never a new page.
 */
export function CrmHeader({
  orgSlug,
  settings,
  title = "CRM",
  toolbar,
  create = "person",
}: {
  orgSlug: string;
  /** The viewer may open CRM settings (owners, admins and CRM managers). */
  settings: boolean;
  title?: string;
  /** The toolbar row under it (CrmToolbar). */
  toolbar?: ReactNode;
  /** What the create button makes in one click (People's Companies view: a company). */
  create?: "person" | "company";
}) {
  const { setOpen } = useCrmOpen();
  const base = `/app/${orgSlug}/crm`;
  return (
    <div className="mb-[30px] space-y-[30px] max-md:mb-5 max-md:space-y-4">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 max-md:flex-nowrap max-md:items-center">
        <h1 className="page-title mr-auto max-md:min-w-0">{title}</h1>
        <div className={cn("flex flex-wrap items-center gap-2", PHONE_SMALL_CREATE)}>
          <CreateSplitButton
            label={create === "company" ? "New company" : "New person"}
            title={create === "company" ? "New company" : "New person"}
            onClick={() => setOpen({ kind: "new", what: create })}
            menuLabel="More to create"
          >
            <DropdownMenuItem onSelect={() => setOpen({ kind: "new", what: "person" })}>
              <UserPlus className="size-4" aria-hidden="true" />
              New person
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setOpen({ kind: "new", what: "company" })}>
              <Building2 className="size-4" aria-hidden="true" />
              New company
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setOpen({ kind: "new", what: "deal" })}>
              <Columns3 className="size-4" aria-hidden="true" />
              New deal
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`${base}/import`}>
                <FileSpreadsheet className="size-4" aria-hidden="true" />
                <span className="flex flex-col">
                  Import a spreadsheet
                  <span className="text-muted-foreground text-xs">
                    People, companies or deals from a CSV
                  </span>
                </span>
              </Link>
            </DropdownMenuItem>
          </CreateSplitButton>
          {settings && (
            <Link
              href={`${base}/settings`}
              aria-label="CRM settings"
              title="CRM settings"
              className="bg-foreground text-background hover:bg-foreground/85 focus-glow grid size-10 shrink-0 place-items-center rounded-full transition-colors"
            >
              <Settings className="size-[18px]" aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>
      {toolbar}
    </div>
  );
}
