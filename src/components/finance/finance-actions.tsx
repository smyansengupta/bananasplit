"use client";

import { FileSpreadsheet, ListChecks, Plus, Receipt } from "@/components/icons";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { CreateSplitButton } from "@/components/ui/create-split-button";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";

import { TransactionDialog } from "./transaction-dialog";

type Create = "transaction" | "request";

const CREATE: Record<Create, { label: string; icon: typeof Plus }> = {
  transaction: { label: "Add transaction", icon: Plus },
  request: { label: "Request a reimbursement", icon: Receipt },
};

/**
 * Finance's header actions, the same on every finance page: the shared
 * create split button, its chevron holding the rest for owners and
 * treasurers (the other kind of new entry, Import, the setup guide). A treasurer's primary
 * is Add transaction, or Request a reimbursement on their own
 * reimbursements; everyone else can only ask to be paid back.
 */
export function FinanceActions({
  orgId,
  orgSlug,
  isFinance,
  currentUserId,
  periods,
  categories,
}: {
  orgId: string;
  orgSlug: string;
  isFinance: boolean;
  currentUserId: string;
  periods: { id: string; label: string }[];
  categories: { id: string; name: string; budgetPeriodId: string }[];
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState<Create | null>(null);
  const base = `/app/${orgSlug}/finance`;
  const primary: Create =
    !isFinance || pathname === `${base}/my-reimbursements` ? "request" : "transaction";
  const other: Create = primary === "request" ? "transaction" : "request";
  const PrimaryIcon = CREATE[primary].icon;
  const OtherIcon = CREATE[other].icon;

  return (
    <>
      <CreateSplitButton
        label={CREATE[primary].label}
        icon={<PrimaryIcon className="size-4" aria-hidden="true" />}
        onClick={() => setOpen(primary)}
        menuLabel="More finance actions"
      >
        {isFinance && (
          <>
            <DropdownMenuItem onSelect={() => setOpen(primary)}>
              <PrimaryIcon className="size-4" aria-hidden="true" />
              {CREATE[primary].label}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setOpen(other)}>
              <OtherIcon className="size-4" aria-hidden="true" />
              {CREATE[other].label}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={`${base}/import`}>
                <FileSpreadsheet className="size-4" aria-hidden="true" />
                Import a spreadsheet
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`${base}/setup`}>
                <ListChecks className="size-4" aria-hidden="true" />
                Setup guide
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </CreateSplitButton>
      <TransactionDialog
        orgId={orgId}
        open={open !== null}
        onOpenChange={(o) => {
          if (!o) setOpen(null);
        }}
        transaction={null}
        periods={periods}
        categories={categories}
        isFinance={isFinance}
        request={open === "request"}
        currentUserId={currentUserId}
      />
    </>
  );
}
