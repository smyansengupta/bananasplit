"use client";

import { ArchiveRestore, PanelRightOpen, Plus, ReceiptText, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { TransactionWithRelations } from "@/app/app/[orgSlug]/finance/queries";
import { deleteTransaction, restoreTransaction } from "@/app/app/[orgSlug]/finance/transactions-actions";
import { ItemMenu } from "@/components/item-menu";
import { Button } from "@/components/ui/button";
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
}: {
  orgId: string;
  transactions: TransactionWithRelations[];
  periods: { id: string; label: string }[];
  categories: { id: string; name: string; budgetPeriodId: string }[];
  isFinance: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  const selected = transactions.find((t) => t.id === openId) ?? null;

  const canDelete = (t: TransactionWithRelations) =>
    !t.voidedAt &&
    !t.reconciledAt &&
    (isFinance ||
      (t.submittedById === currentUserId && t.kind === "EXPENSE" && (t.status === "DRAFT" || t.status === "SUBMITTED")));

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

  if (transactions.length === 0) {
    return (
      <EmptyState
        icon={ReceiptText}
        title="No transactions here"
        description="Nothing matches these filters yet. Use “Add transaction” to record money in or out: an expense, a sponsorship, dues or other income."
      />
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Submitted by</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="w-10">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {transactions.map((t) => (
            <TableRow
              key={t.id}
              className={cn("cursor-pointer", t.voidedAt && "opacity-50")}
              onClick={() => {
                setOpenId(t.id);
                setDialogOpen(true);
              }}
            >
              <TableCell>{t.occurredAt.toLocaleDateString()}</TableCell>
              <TableCell className={cn(t.voidedAt && "line-through")}>{t.description}</TableCell>
              <TableCell>{t.category?.name ?? "—"}</TableCell>
              <TableCell>{t.submittedBy.name ?? t.submittedBy.email}</TableCell>
              <TableCell>
                {isDeletedTransaction(t) ? (
                  <span className="text-destructive text-xs font-medium">Deleted</span>
                ) : (
                  <TransactionStatusBadge status={t.status} />
                )}
                {t.reconciledAt && (
                  <span className="text-muted-foreground ml-1.5 text-xs">locked</span>
                )}
              </TableCell>
              <TableCell className={cn("text-right", t.direction === "IN" && "text-success")}>
                {t.direction === "IN" ? "+" : "-"}
                {formatCents(t.amountCents)}
              </TableCell>
              <TableCell className="w-10 py-1 text-right">
                <ItemMenu
                  label={`Actions for ${t.description}`}
                  items={[
                    {
                      label: "Open",
                      icon: PanelRightOpen,
                      onSelect: () => {
                        setOpenId(t.id);
                        setDialogOpen(true);
                      },
                    },
                    t.voidedAt && isFinance && {
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
                  ]}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

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

export function NewTransactionButton({
  orgId,
  periods,
  categories,
  isFinance,
  currentUserId,
}: {
  orgId: string;
  periods: { id: string; label: string }[];
  categories: { id: string; name: string; budgetPeriodId: string }[];
  isFinance: boolean;
  currentUserId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden="true" />
        Add transaction
      </Button>
      <TransactionDialog
        orgId={orgId}
        open={open}
        onOpenChange={setOpen}
        transaction={null}
        periods={periods}
        categories={categories}
        isFinance={isFinance}
        currentUserId={currentUserId}
      />
    </>
  );
}
