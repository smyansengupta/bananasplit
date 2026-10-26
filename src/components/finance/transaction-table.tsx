"use client";

import { ArchiveRestore, Lock, ReceiptText, Trash2 } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { TransactionWithRelations } from "@/app/app/[orgSlug]/finance/queries";
import {
  deleteTransaction,
  restoreTransaction,
} from "@/app/app/[orgSlug]/finance/transactions-actions";
import { TableFrame } from "@/components/databases/table-frame";
import { ItemMenu } from "@/components/item-menu";
import { seriesColor } from "@/components/reports/charts/chart-kit";
import { Badge } from "@/components/ui/badge";
import { TagChip } from "@/components/ui/chip";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toaster";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { isDeletedTransaction } from "@/lib/finance/deleted";
import { formatCents } from "@/lib/finance/money";
import { formatFinanceDate } from "@/lib/finance/stats";
import { cn } from "@/lib/utils";

import { TransactionDialog } from "./transaction-dialog";
import { TransactionStatusBadge } from "./transaction-status-badge";
import { EmptyState } from "@/components/empty-state";

export function TransactionTable({
  orgId,
  transactions,
  periods,
  categories,
  isFinance,
  currentUserId,
  emptyDescription = "Nothing matches these filters yet. Use “Add transaction” to record money in or out: an expense, a sponsorship, dues or other income.",
}: {
  orgId: string;
  transactions: TransactionWithRelations[];
  periods: { id: string; label: string }[];
  categories: { id: string; name: string; budgetPeriodId: string }[];
  isFinance: boolean;
  currentUserId: string;
  /** What the empty list says, naming the header button that fills it. */
  emptyDescription?: string;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  const selected = transactions.find((t) => t.id === openId) ?? null;
  // A category keeps its chart slot (its place in its budget) here too.
  const slot = new Map<string, string>();
  const seen = new Map<string, number>();
  for (const c of categories) {
    const i = seen.get(c.budgetPeriodId) ?? 0;
    slot.set(c.id, seriesColor(i));
    seen.set(c.budgetPeriodId, i + 1);
  }

  const canDelete = (t: TransactionWithRelations) =>
    !t.voidedAt &&
    !t.reconciledAt &&
    (isFinance ||
      (t.submittedById === currentUserId &&
        t.kind === "EXPENSE" &&
        (t.status === "DRAFT" || t.status === "SUBMITTED")));

  async function remove(t: TransactionWithRelations) {
    const ok = await confirm({
      title: `Delete “${t.description}”?`,
      description:
        "It comes out of every list and total. The finance activity log keeps a record, and you can undo this right after.",
      confirmLabel: "Delete transaction",
      run: async () => (await deleteTransaction(orgId, t.id)).error,
    });
    if (!ok) return;
    router.refresh();
    toast({
      title: "Transaction deleted",
      description: t.description,
      action: {
        label: "Undo",
        run: async () => {
          const result = await restoreTransaction(orgId, t.id);
          if (result.error) return result.error;
          router.refresh();
        },
      },
    });
  }

  async function restore(t: TransactionWithRelations) {
    const result = await restoreTransaction(orgId, t.id);
    if (result.error) {
      toast({ title: "Couldn't restore it", description: result.error, tone: "error" });
      return;
    }
    toast({ title: "Transaction restored", description: t.description, tone: "success" });
    router.refresh();
  }

  const menuItems = (t: TransactionWithRelations) => [
    t.voidedAt &&
      isFinance && {
        label: "Restore",
        icon: ArchiveRestore,
        onSelect: () => void restore(t),
      },
    canDelete(t) && {
      label: "Delete",
      icon: Trash2,
      destructive: true,
      onSelect: () => void remove(t),
    },
  ];
  const open = (t: TransactionWithRelations) => {
    setOpenId(t.id);
    setDialogOpen(true);
  };
  const status = (t: TransactionWithRelations) =>
    isDeletedTransaction(t) ? (
      <Badge variant="destructive">Deleted</Badge>
    ) : t.status === "NOT_APPLICABLE" ? null : (
      <TransactionStatusBadge status={t.status} />
    );
  const amount = (t: TransactionWithRelations) => (
    <>
      {t.direction === "IN" ? "+" : "−"}
      {formatCents(t.amountCents)}
    </>
  );

  if (transactions.length === 0) {
    return (
      <EmptyState icon={ReceiptText} title="No transactions here" description={emptyDescription} />
    );
  }

  return (
    <>
      {/*
        A phone gets a list, not a seven-column table it can only show two
        columns of: what and how much on the first line, when, the category
        and the status under it. A tap opens the transaction, like a row.
      */}
      <ul className="bg-card edge rounded-card divide-border/70 divide-y px-1.5 md:hidden">
        {transactions.map((t) => (
          <li key={t.id} className={cn("flex items-center gap-1", t.voidedAt && "opacity-50")}>
            <button
              type="button"
              onClick={() => open(t)}
              className="focus-visible:outline-foreground flex min-h-16 min-w-0 flex-1 flex-col justify-center gap-1 rounded-md px-2.5 py-3 text-left focus-visible:outline-2"
            >
              <span className="flex items-baseline gap-3">
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-[15px] font-medium",
                    t.voidedAt && "line-through",
                  )}
                >
                  {t.description}
                </span>
                <span
                  className={cn(
                    "shrink-0 font-semibold tabular-nums",
                    t.direction === "IN" && "text-success",
                  )}
                >
                  {amount(t)}
                </span>
              </span>
              <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                <span className="tabular-nums">{formatFinanceDate(t.occurredAt)}</span>
                {t.category && (
                  <TagChip color={slot.get(t.category.id) ?? "var(--muted-foreground)"}>
                    {t.category.name}
                  </TagChip>
                )}
                {status(t)}
                {t.reconciledAt && (
                  <span className="inline-flex items-center gap-1 text-xs">
                    <Lock className="size-3.5" aria-hidden="true" />
                    Locked
                  </span>
                )}
              </span>
            </button>
            <ItemMenu label={`Actions for ${t.description}`} items={menuItems(t)} />
          </li>
        ))}
      </ul>

      <TableFrame className="max-md:hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Submitted by</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right tabular-nums">Amount</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.map((t) => (
              <TableRow
                key={t.id}
                data-state={dialogOpen && openId === t.id ? "selected" : undefined}
                className={cn("cursor-pointer", t.voidedAt && "opacity-50")}
                onClick={() => open(t)}
              >
                <TableCell className="text-muted-foreground whitespace-nowrap tabular-nums">
                  {formatFinanceDate(t.occurredAt)}
                </TableCell>
                <TableCell
                  className={cn("max-w-80 truncate font-medium", t.voidedAt && "line-through")}
                >
                  {t.description}
                </TableCell>
                <TableCell>
                  {t.category ? (
                    <TagChip color={slot.get(t.category.id) ?? "var(--muted-foreground)"}>
                      {t.category.name}
                    </TagChip>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {t.submittedBy.name ?? t.submittedBy.email}
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1.5">
                    {isDeletedTransaction(t) ? (
                      <Badge variant="destructive">Deleted</Badge>
                    ) : t.status === "NOT_APPLICABLE" ? (
                      <span className="text-muted-foreground" title="Not an expense">
                        —
                      </span>
                    ) : (
                      <TransactionStatusBadge status={t.status} />
                    )}
                    {t.reconciledAt && (
                      <span
                        className="text-muted-foreground inline-flex items-center gap-1 text-xs"
                        title="Reconciled: locked"
                      >
                        <Lock className="size-3.5" aria-hidden="true" />
                        Locked
                      </span>
                    )}
                  </span>
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-semibold tabular-nums",
                    t.direction === "IN" && "text-success",
                  )}
                >
                  {amount(t)}
                </TableCell>
                <TableCell className="w-10 py-1 text-right">
                  {/* Opening it is the row click; the menu holds the rest. */}
                  <ItemMenu label={`Actions for ${t.description}`} items={menuItems(t)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableFrame>

      <TransactionDialog
        orgId={orgId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        transaction={selected}
        periods={periods}
        categories={categories}
        isFinance={isFinance}
        currentUserId={currentUserId}
      />
      {confirmEl}
    </>
  );
}
