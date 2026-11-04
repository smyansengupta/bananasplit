"use client";

import {
  ArchiveRestore,
  Ban,
  Banknote,
  Check,
  Lock,
  ReceiptText,
  X,
} from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { TransactionWithRelations } from "@/app/app/[orgSlug]/finance/queries";
import {
  approveAndPayExpense,
  approveExpense,
  approveExpenses,
  askForReceipt,
  deleteTransaction,
  payExpenses,
  reconcileTransactions,
  reimburseExpense,
  restoreTransaction,
  type BulkResult,
} from "@/app/app/[orgSlug]/finance/transactions-actions";
import { AmbientActions, type AmbientAction } from "@/components/ambient/ambient-button";
import { TableFrame } from "@/components/databases/table-frame";
import { EmptyState } from "@/components/empty-state";
import { lastPayMethod, PayMethodChips, rememberPayMethod } from "@/components/finance/pay-method";
import { ItemMenu } from "@/components/item-menu";
import { seriesColor } from "@/components/reports/charts/chart-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TagChip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { toast, undoable } from "@/components/ui/toaster";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  approvedNotPaid,
  askLabel,
  needsReceipt,
  receiptReason,
  unpaidReason,
} from "@/lib/ambient/finance";
import { formatCents } from "@/lib/finance/money";
import { formatFinanceDate } from "@/lib/finance/stats";
import { cn } from "@/lib/utils";

import { ReceiptThumb } from "./receipt-thumb";

import { TransactionDialog } from "./transaction-dialog";
import { TransactionStatusBadge } from "./transaction-status-badge";

/**
 * The ledger. Rows open the transaction; a treasurer works the queue from
 * the row itself (Approve, Pay with the method used last) or ticks several
 * and approves, pays or reconciles them at once. Void comes with Undo, so it
 * never asks first. `?open=<id>` on the page opens that transaction.
 */
export function TransactionTable({
  orgId,
  transactions,
  periods,
  categories,
  isFinance,
  currentUserId,
  initialOpenId,
  emptyDescription,
}: {
  orgId: string;
  transactions: TransactionWithRelations[];
  periods: { id: string; label: string }[];
  categories: { id: string; name: string; budgetPeriodId: string }[];
  isFinance: boolean;
  currentUserId: string;
  /** Open this one on arrival (a link from the dashboard, an email or search). */
  initialOpenId?: string;
  emptyDescription?: string;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? null);
  const [dialogOpen, setDialogOpen] = useState(Boolean(initialOpenId));
  const [pickedRaw, setPicked] = useState<Set<string>>(new Set());
  // Rows that left the list (paid, filtered away) leave the selection too.
  const picked = new Set(transactions.filter((t) => pickedRaw.has(t.id)).map((t) => t.id));
  const [pending, startTransition] = useTransition();
  const selected = transactions.find((t) => t.id === openId) ?? null;
  // When the table was loaded: the ambient buttons' "3 days ago".
  const [now] = useState(() => new Date());

  // A category keeps its chart slot (its place in its budget) here too.
  const slot = new Map<string, string>();
  const seen = new Map<string, number>();
  for (const c of categories) {
    const i = seen.get(c.budgetPeriodId) ?? 0;
    slot.set(c.id, seriesColor(i));
    seen.set(c.budgetPeriodId, i + 1);
  }

  const canVoid = (t: TransactionWithRelations) =>
    !t.voidedAt &&
    !t.reconciledAt &&
    (isFinance ||
      (t.submittedById === currentUserId &&
        t.kind === "EXPENSE" &&
        (t.status === "DRAFT" || t.status === "SUBMITTED")));
  const reviewable = (t: TransactionWithRelations) =>
    isFinance &&
    t.kind === "EXPENSE" &&
    !t.voidedAt &&
    !t.reconciledAt &&
    t.submittedById !== currentUserId &&
    (t.status === "SUBMITTED" || t.status === "APPROVED");

  function voidIt(t: TransactionWithRelations) {
    void undoable({
      title: "Voided",
      run: async () => {
        const result = await deleteTransaction(orgId, t.id);
        router.refresh();
        return result.error;
      },
      undo: async () => {
        const back = await restoreTransaction(orgId, t.id);
        if (back.error) return back.error;
        router.refresh();
      },
    });
  }

  function restore(t: TransactionWithRelations) {
    startTransition(async () => {
      const result = await restoreTransaction(orgId, t.id);
      if (result.error) toast({ title: result.error, tone: "error" });
      else toast({ title: "Restored", tone: "success" });
      router.refresh();
    });
  }

  /** One row's step: Approve, or Pay with the method used last (or open it to pick one). */
  function step(t: TransactionWithRelations, how: "approve" | "pay") {
    const method = lastPayMethod();
    if (how === "pay" && !method) {
      open(t);
      return;
    }
    startTransition(async () => {
      const result =
        how === "approve"
          ? await approveExpense(orgId, t.id)
          : t.status === "SUBMITTED"
            ? await approveAndPayExpense(orgId, t.id, method)
            : await reimburseExpense(orgId, t.id, method);
      if (result.error) toast({ title: result.error, tone: "error" });
      else
        toast({ title: how === "approve" ? "Approved" : `Paid with ${method}`, tone: "success" });
      router.refresh();
    });
  }

  function bulk(run: () => Promise<BulkResult>, verb: string) {
    startTransition(async () => {
      const result = await run();
      if (result.done > 0) {
        toast({
          title: `${verb} ${result.done}`,
          description: result.failed > 0 ? `${result.failed} skipped: ${result.error}` : undefined,
          tone: result.failed > 0 ? "default" : "success",
        });
      } else if (result.error) {
        toast({ title: result.error, tone: "error" });
      }
      setPicked(new Set());
      router.refresh();
    });
  }

  const menuItems = (t: TransactionWithRelations) => [
    t.voidedAt &&
      isFinance && { label: "Restore", icon: ArchiveRestore, onSelect: () => restore(t) },
    canVoid(t) && { label: "Void", icon: Ban, destructive: true, onSelect: () => voidIt(t) },
  ];
  const open = (t: TransactionWithRelations) => {
    setOpenId(t.id);
    setDialogOpen(true);
  };
  const status = (t: TransactionWithRelations) =>
    t.voidedAt ? (
      <Badge variant="destructive">Voided</Badge>
    ) : t.status === "NOT_APPLICABLE" ? null : (
      <TransactionStatusBadge status={t.status} />
    );
  const amount = (t: TransactionWithRelations) => (
    <>
      {t.direction === "IN" ? "+" : "−"}
      {formatCents(t.amountCents)}
    </>
  );
  const reconciled = (t: TransactionWithRelations) =>
    t.reconciledAt ? (
      <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
        <Lock className="size-3.5" aria-hidden="true" />
        Reconciled
      </span>
    ) : null;

  /**
   * The row's ambient buttons (src/lib/ambient/finance.ts): Mark paid on an
   * approved request, Ask for receipt on money out with none attached.
   */
  const facts = (t: TransactionWithRelations) => ({
    ...t,
    receipts: t.receipts.length,
    receiptAskedAt: t.auditLogs[0]?.createdAt ?? null,
  });
  const markPaid = (t: TransactionWithRelations) => isFinance && approvedNotPaid(facts(t), currentUserId);
  const ambientFor = (t: TransactionWithRelations): AmbientAction[] => {
    if (!isFinance) return [];
    const out: AmbientAction[] = [];
    if (markPaid(t)) {
      out.push({
        key: "paid",
        label: "Mark paid",
        icon: Banknote,
        reason: unpaidReason(t, now),
        tone: "solid",
        ariaLabel: `Mark ${t.description} paid`,
        run: () => reimburseExpense(orgId, t.id, lastPayMethod()),
        done: "Paid",
      });
    }
    if (t.status !== "SUBMITTED" && needsReceipt(facts(t), currentUserId, now)) {
      out.push({
        key: "receipt",
        label: askLabel(t.submittedBy.name),
        reason: receiptReason(t, now),
        ariaLabel: `Ask for the receipt for ${t.description}`,
        run: () => askForReceipt(orgId, t.id),
        done: "Asked for the receipt",
      });
    }
    return out;
  };
  const ambient = (t: TransactionWithRelations) => {
    const actions = ambientFor(t);
    return actions.length > 0 ? (
      <span className="relative z-10 inline-flex" onClick={(e) => e.stopPropagation()}>
        <AmbientActions why actions={actions} />
      </span>
    ) : null;
  };

  const receiptMark = (t: TransactionWithRelations) =>
    t.receipts[0] ? <ReceiptThumb orgId={orgId} receipt={t.receipts[0]} /> : null;
  const stepButtons = (t: TransactionWithRelations) =>
    reviewable(t) ? (
      <span className="relative z-10 inline-flex gap-1.5" onClick={(e) => e.stopPropagation()}>
        {t.status === "SUBMITTED" && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => step(t, "approve")}>
            <Check aria-hidden="true" />
            Approve
          </Button>
        )}
        {!markPaid(t) && (
          <Button size="sm" disabled={pending} onClick={() => step(t, "pay")}>
            <Banknote aria-hidden="true" />
            Pay
          </Button>
        )}
      </span>
    ) : null;

  if (transactions.length === 0) {
    return <EmptyState icon={ReceiptText} title={emptyDescription ?? "Nothing here"} />;
  }

  const allPicked = picked.size > 0 && picked.size === transactions.length;
  const pickedRows = transactions.filter((t) => picked.has(t.id));

  return (
    <>
      {isFinance && picked.size > 0 && (
        <BulkBar
          count={picked.size}
          pending={pending}
          canApprove={pickedRows.some((t) => t.status === "SUBMITTED" && reviewable(t))}
          canPay={pickedRows.some(reviewable)}
          onApprove={() => bulk(() => approveExpenses(orgId, [...picked]), "Approved")}
          onPay={(method) => {
            rememberPayMethod(method);
            bulk(() => payExpenses(orgId, [...picked], method), "Paid");
          }}
          onReconcile={(ref) =>
            bulk(() => reconcileTransactions(orgId, [...picked], ref), "Reconciled")
          }
          onClear={() => setPicked(new Set())}
        />
      )}

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
                    "min-w-0 flex-1 text-[15px] font-medium break-words",
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
                {reconciled(t)}
              </span>
            </button>
            {stepButtons(t)}
            {ambient(t)}
            <ItemMenu label={`Actions for ${t.description}`} items={menuItems(t)} />
          </li>
        ))}
      </ul>

      <TableFrame className="max-md:hidden">
        <Table>
          <TableHeader>
            <TableRow>
              {isFinance && (
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all"
                    checked={allPicked ? true : picked.size > 0 ? "indeterminate" : false}
                    onCheckedChange={(v) =>
                      setPicked(v === true ? new Set(transactions.map((t) => t.id)) : new Set())
                    }
                  />
                </TableHead>
              )}
              <TableHead>Date</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Category</TableHead>
              {isFinance && <TableHead>By</TableHead>}
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
                data-state={
                  (dialogOpen && openId === t.id) || picked.has(t.id) ? "selected" : undefined
                }
                className={cn("cursor-pointer", t.voidedAt && "opacity-50")}
                onClick={() => open(t)}
              >
                {isFinance && (
                  <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      aria-label={`Select ${t.description}`}
                      checked={picked.has(t.id)}
                      onCheckedChange={(v) =>
                        setPicked((prev) => {
                          const next = new Set(prev);
                          if (v === true) next.add(t.id);
                          else next.delete(t.id);
                          return next;
                        })
                      }
                    />
                  </TableCell>
                )}
                <TableCell className="text-muted-foreground whitespace-nowrap tabular-nums">
                  {formatFinanceDate(t.occurredAt)}
                </TableCell>
                <TableCell className={cn("max-w-96 font-medium", t.voidedAt && "line-through")}>
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 break-words whitespace-normal">{t.description}</span>
                    {receiptMark(t)}
                  </span>
                </TableCell>
                <TableCell>
                  {t.category ? (
                    <TagChip color={slot.get(t.category.id) ?? "var(--muted-foreground)"}>
                      {t.category.name}
                    </TagChip>
                  ) : null}
                </TableCell>
                {isFinance && (
                  <TableCell className="text-muted-foreground">
                    {t.submittedBy.name ?? t.submittedBy.email}
                  </TableCell>
                )}
                <TableCell>
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    {status(t)}
                    {reconciled(t)}
                    {stepButtons(t)}
                    {ambient(t)}
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
                <TableCell className="w-10 py-1 text-right" onClick={(e) => e.stopPropagation()}>
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
    </>
  );
}

/** What to do with the ticked rows. Paying asks how, once, for all of them. */
function BulkBar({
  count,
  pending,
  canApprove,
  canPay,
  onApprove,
  onPay,
  onReconcile,
  onClear,
}: {
  count: number;
  pending: boolean;
  canApprove: boolean;
  canPay: boolean;
  onApprove: () => void;
  onPay: (method: string) => void;
  onReconcile: (statementRef: string) => void;
  onClear: () => void;
}) {
  const [mode, setMode] = useState<"pay" | "reconcile" | null>(null);
  // Only ever shown after a click, so the browser's storage is there to read.
  const [method, setMethod] = useState(lastPayMethod);
  const [ref, setRef] = useState("");

  return (
    <div
      role="region"
      aria-label="Selected transactions"
      className="bg-card edge rounded-card flex flex-wrap items-center gap-2 p-2.5 ps-4"
    >
      <span className="text-sm font-semibold tabular-nums">{count} selected</span>
      {mode === "pay" ? (
        <>
          <PayMethodChips value={method} onChange={setMethod} />
          <Button size="sm" disabled={pending || !method.trim()} onClick={() => onPay(method)}>
            <Banknote aria-hidden="true" />
            Pay {count}
          </Button>
        </>
      ) : mode === "reconcile" ? (
        <>
          <Input
            aria-label="Statement reference (optional)"
            placeholder="Statement, optional"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            className="h-8 w-48"
          />
          <Button size="sm" disabled={pending} onClick={() => onReconcile(ref)}>
            <Lock aria-hidden="true" />
            Reconcile {count}
          </Button>
        </>
      ) : (
        <>
          {canApprove && (
            <Button size="sm" variant="outline" disabled={pending} onClick={onApprove}>
              <Check aria-hidden="true" />
              Approve
            </Button>
          )}
          {canPay && (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setMode("pay")}>
              <Banknote aria-hidden="true" />
              Pay
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => setMode("reconcile")}
          >
            <Lock aria-hidden="true" />
            Reconcile
          </Button>
        </>
      )}
      <button
        type="button"
        aria-label="Clear the selection"
        onClick={mode ? () => setMode(null) : onClear}
        className="text-muted-foreground hover:text-foreground hover:bg-muted ms-auto grid size-8 place-items-center rounded-full"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
