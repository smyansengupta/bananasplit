"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import type { TransactionWithRelations } from "@/app/app/[orgSlug]/finance/queries";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCents } from "@/lib/finance/money";
import { cn } from "@/lib/utils";

import { TransactionDialog } from "./transaction-dialog";
import { TransactionStatusBadge } from "./transaction-status-badge";

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
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const selected = transactions.find((t) => t.id === openId) ?? null;

  if (transactions.length === 0) {
    return <p className="text-muted-foreground text-sm">No transactions match these filters.</p>;
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
                <TransactionStatusBadge status={t.status} />
                {t.reconciledAt && (
                  <span className="text-muted-foreground ml-1.5 text-xs">locked</span>
                )}
              </TableCell>
              <TableCell className={cn("text-right", t.direction === "IN" && "text-success")}>
                {t.direction === "IN" ? "+" : "-"}
                {formatCents(t.amountCents)}
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
