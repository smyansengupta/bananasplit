"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import {
  approveExpense,
  createTransaction,
  markExpenseNotApplicable,
  reconcileTransaction,
  rejectExpense,
  reimburseExpense,
  submitExpense,
  unlockTransaction,
  updateTransaction,
  voidTransaction,
  withdrawExpense,
} from "@/app/app/[orgSlug]/finance/transactions-actions";
import {
  deleteReceiptAction,
  getSignedReceiptUrl,
  uploadReceipt,
} from "@/app/app/[orgSlug]/finance/receipts-actions";
import type { TransactionWithRelations } from "@/app/app/[orgSlug]/finance/queries";
import { TransactionKindSelect } from "@/components/finance/transaction-kind-select";
import { TransactionStatusBadge } from "@/components/finance/transaction-status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { TransactionDirection, TransactionKind } from "@/generated/prisma/enums";
import { formatCents, parseDollarsToCents } from "@/lib/finance/money";
import { toDateInputValue } from "@/components/tasks/utils";

interface Props {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: TransactionWithRelations | null;
  periods: { id: string; label: string }[];
  categories: { id: string; name: string; budgetPeriodId: string }[];
  isFinance: boolean;
  currentUserId: string;
  onSaved?: () => void;
}

export function TransactionDialog({ open, onOpenChange, transaction, ...rest }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {open && (
          <TransactionForm
            key={transaction?.id ?? "new"}
            transaction={transaction}
            onOpenChange={onOpenChange}
            {...rest}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TransactionForm({
  orgId,
  onOpenChange,
  transaction,
  periods,
  categories,
  isFinance,
  currentUserId,
  onSaved,
}: Omit<Props, "open">) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const restrictToExpense = !isFinance;
  const [kind, setKind] = useState<TransactionKind>(transaction?.kind ?? TransactionKind.EXPENSE);
  const [direction, setDirection] = useState<TransactionDirection>(
    transaction?.direction ?? TransactionDirection.OUT,
  );
  const [budgetPeriodId, setBudgetPeriodId] = useState(
    transaction?.budgetPeriodId ?? periods[0]?.id ?? "",
  );
  const [categoryId, setCategoryId] = useState<string | null>(transaction?.categoryId ?? null);
  const [amount, setAmount] = useState(
    transaction ? (transaction.amountCents / 100).toFixed(2) : "",
  );
  const [description, setDescription] = useState(transaction?.description ?? "");
  const [counterparty, setCounterparty] = useState(transaction?.counterparty ?? "");
  const [paymentMethod, setPaymentMethod] = useState(transaction?.paymentMethod ?? "");
  const [occurredAt, setOccurredAt] = useState(
    transaction ? toDateInputValue(transaction.occurredAt) : toDateInputValue(new Date()),
  );

  const canEditFields =
    !transaction ||
    (isFinance && !transaction.reconciledAt) ||
    (transaction.submittedById === currentUserId && transaction.status === "DRAFT");

  function handleSave() {
    setError(null);
    startTransition(async () => {
      let amountCents: number;
      try {
        amountCents = parseDollarsToCents(amount);
      } catch {
        setError("Enter a valid dollar amount.");
        return;
      }

      const input = {
        budgetPeriodId,
        categoryId,
        direction,
        kind,
        amountCents,
        description,
        counterparty: counterparty || null,
        occurredAt: new Date(occurredAt).toISOString(),
        paymentMethod: paymentMethod || null,
      };

      const result = transaction
        ? await updateTransaction(orgId, transaction.id, input)
        : await createTransaction(orgId, input);

      if (result?.error) {
        setError(result.error);
        return;
      }
      onOpenChange(false);
      onSaved?.();
      router.refresh();
    });
  }

  const periodCategories = categories.filter((c) => c.budgetPeriodId === budgetPeriodId);

  const fieldsForm = (
    <div className="space-y-4">
      <div className="grid gap-1.5">
        <Label>Kind</Label>
        <TransactionKindSelect
          value={kind}
          onChange={(k) => {
            setKind(k);
            if (k === TransactionKind.EXPENSE) setDirection(TransactionDirection.OUT);
            if (k === TransactionKind.SPONSORSHIP || k === TransactionKind.OTHER_INCOME) {
              setDirection(TransactionDirection.IN);
            }
          }}
          disabled={!canEditFields || Boolean(transaction)}
          restrictToExpense={restrictToExpense}
        />
      </div>

      {(kind === TransactionKind.ADJUSTMENT || kind === TransactionKind.ALLOCATION) && (
        <div className="grid gap-1.5">
          <Label>Direction</Label>
          <Select
            value={direction}
            onValueChange={(v) => setDirection(v as TransactionDirection)}
            disabled={!canEditFields}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="IN">In</SelectItem>
              <SelectItem value="OUT">Out</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="txn-description">Description</Label>
        <Textarea
          id="txn-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={!canEditFields}
          rows={2}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="txn-amount">Amount</Label>
          <Input
            id="txn-amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={!canEditFields}
            placeholder="0.00"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="txn-date">Date</Label>
          <Input
            id="txn-date"
            type="date"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            disabled={!canEditFields}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label>Budget period</Label>
          <Select
            value={budgetPeriodId}
            onValueChange={setBudgetPeriodId}
            // A saved transaction never moves between periods (the server
            // ignores budgetPeriodId on update), so the picker is fixed then.
            disabled={!canEditFields || Boolean(transaction)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {periods.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Category</Label>
          <Select
            value={categoryId ?? "none"}
            onValueChange={(v) => setCategoryId(v === "none" ? null : v)}
            disabled={!canEditFields}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No category</SelectItem>
              {periodCategories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="txn-counterparty">Counterparty</Label>
          <Input
            id="txn-counterparty"
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
            disabled={!canEditFields}
            placeholder="Who was paid / who paid us"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="txn-payment-method">Payment method</Label>
          <Input
            id="txn-payment-method"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            disabled={!canEditFields}
            placeholder="Club card, cash, check…"
          />
        </div>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {transaction ? "Transaction" : "New transaction"}
          {transaction && <TransactionStatusBadge status={transaction.status} />}
          {transaction?.voidedAt && <span className="text-destructive text-xs">Voided</span>}
          {transaction?.reconciledAt && (
            <span className="text-muted-foreground text-xs">Reconciled</span>
          )}
        </DialogTitle>
        <DialogDescription className="sr-only">Transaction details</DialogDescription>
      </DialogHeader>

      {transaction ? (
        <Tabs defaultValue="details">
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="receipts">Receipts ({transaction.receipts.length})</TabsTrigger>
            {isFinance && <TabsTrigger value="activity">Activity</TabsTrigger>}
          </TabsList>
          <TabsContent value="details" className="space-y-4">
            {fieldsForm}
            <ExpenseActions
              orgId={orgId}
              transaction={transaction}
              isFinance={isFinance}
              currentUserId={currentUserId}
              onDone={() => {
                onSaved?.();
                router.refresh();
              }}
            />
          </TabsContent>
          <TabsContent value="receipts">
            <ReceiptsPanel
              orgId={orgId}
              transaction={transaction}
              onChanged={() => router.refresh()}
            />
          </TabsContent>
          {isFinance && (
            <TabsContent value="activity">
              <ActivityPanel transaction={transaction} />
            </TabsContent>
          )}
        </Tabs>
      ) : (
        fieldsForm
      )}

      <DialogFooter className="mt-6">
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Close
        </Button>
        {canEditFields && (
          <Button type="button" onClick={handleSave} disabled={isPending || !description.trim()}>
            {transaction ? "Save" : "Create"}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

type PendingReasonAction = "REJECT" | "VOID" | "UNLOCK" | "RECONCILE";

const REASON_PROMPT: Record<PendingReasonAction, { label: string; required: boolean }> = {
  REJECT: { label: "Reason for rejecting this expense", required: true },
  VOID: { label: "Reason for voiding this transaction", required: true },
  UNLOCK: { label: "Reason for unlocking this reconciled transaction", required: true },
  RECONCILE: { label: "Statement reference (optional)", required: false },
};

function ExpenseActions({
  orgId,
  transaction,
  isFinance,
  currentUserId,
  onDone,
}: {
  orgId: string;
  transaction: TransactionWithRelations;
  isFinance: boolean;
  currentUserId: string;
  onDone: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reimburseMethod, setReimburseMethod] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingReasonAction | null>(null);
  const [reasonText, setReasonText] = useState("");

  const isSubmitter = transaction.submittedById === currentUserId;
  const isExpense = transaction.kind === "EXPENSE";
  const locked = Boolean(transaction.reconciledAt);

  function run(action: () => Promise<{ error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result?.error) {
        setError(result.error);
        return;
      }
      setPendingAction(null);
      setReasonText("");
      onDone();
    });
  }

  function confirmReasonAction() {
    if (!pendingAction) return;
    switch (pendingAction) {
      case "REJECT":
        run(() => rejectExpense(orgId, transaction.id, reasonText));
        return;
      case "VOID":
        run(() => voidTransaction(orgId, transaction.id, reasonText));
        return;
      case "UNLOCK":
        run(() => unlockTransaction(orgId, transaction.id, reasonText));
        return;
      case "RECONCILE":
        run(() => reconcileTransaction(orgId, transaction.id, reasonText));
        return;
    }
  }

  if (pendingAction) {
    const prompt = REASON_PROMPT[pendingAction];
    return (
      <div className="space-y-2 border-t pt-4">
        {error && <p className="text-destructive text-sm">{error}</p>}
        <Label htmlFor="reason-text">{prompt.label}</Label>
        <Input
          id="reason-text"
          autoFocus
          value={reasonText}
          onChange={(e) => setReasonText(e.target.value)}
        />
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setPendingAction(null);
              setReasonText("");
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={isPending || (prompt.required && !reasonText.trim())}
            onClick={confirmReasonAction}
          >
            Confirm
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 border-t pt-4">
      {error && <p className="text-destructive text-sm">{error}</p>}

      {isExpense && !locked && (
        <div className="flex flex-wrap gap-2">
          {transaction.status === "DRAFT" && isSubmitter && (
            <Button size="sm" onClick={() => run(() => submitExpense(orgId, transaction.id))}>
              Submit
            </Button>
          )}
          {transaction.status === "DRAFT" && (isSubmitter || isFinance) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => run(() => markExpenseNotApplicable(orgId, transaction.id))}
            >
              Mark not applicable
            </Button>
          )}
          {transaction.status === "SUBMITTED" && isSubmitter && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => run(() => withdrawExpense(orgId, transaction.id))}
            >
              Withdraw
            </Button>
          )}
          {(transaction.status === "SUBMITTED" || transaction.status === "APPROVED") &&
            isFinance &&
            !isSubmitter && (
              <>
                {transaction.status === "SUBMITTED" && (
                  <Button
                    size="sm"
                    onClick={() => run(() => approveExpense(orgId, transaction.id))}
                  >
                    Approve
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setPendingAction("REJECT")}>
                  Reject
                </Button>
              </>
            )}
          {transaction.status === "APPROVED" && isFinance && !isSubmitter && (
            <div className="flex items-center gap-2">
              <Input
                placeholder="Reimbursement method"
                value={reimburseMethod}
                onChange={(e) => setReimburseMethod(e.target.value)}
                className="h-8 w-48"
              />
              <Button
                size="sm"
                disabled={!reimburseMethod.trim()}
                onClick={() => run(() => reimburseExpense(orgId, transaction.id, reimburseMethod))}
              >
                Mark reimbursed
              </Button>
            </div>
          )}
        </div>
      )}

      {isFinance && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {!locked && !transaction.voidedAt && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={isPending}
              onClick={() => setPendingAction("VOID")}
            >
              Void
            </Button>
          )}
          {!locked ? (
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => setPendingAction("RECONCILE")}
            >
              Reconcile
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => setPendingAction("UNLOCK")}
            >
              Unlock
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function ReceiptsPanel({
  orgId,
  transaction,
  onChanged,
}: {
  orgId: string;
  transaction: TransactionWithRelations;
  onChanged: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleUpload(file: File) {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("file", file);
      const result = await uploadReceipt(orgId, transaction.id, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      onChanged();
    });
  }

  async function handleView(receiptId: string) {
    const result = await getSignedReceiptUrl(orgId, receiptId);
    if (result.url) window.open(result.url, "_blank", "noopener,noreferrer");
  }

  function handleDelete(receiptId: string) {
    startTransition(async () => {
      await deleteReceiptAction(orgId, receiptId);
      onChanged();
    });
  }

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUpload(file);
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={() => inputRef.current?.click()}
      >
        Upload receipt
      </Button>
      {error && <p className="text-destructive text-sm">{error}</p>}

      {transaction.receipts.length === 0 ? (
        <p className="text-muted-foreground text-sm">No receipts attached.</p>
      ) : (
        <ul className="space-y-1.5">
          {transaction.receipts.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
              <button
                type="button"
                onClick={() => handleView(r.id)}
                className="text-primary truncate hover:underline"
              >
                {r.filename}
              </button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleDelete(r.id)}
                disabled={isPending}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActivityPanel({ transaction }: { transaction: TransactionWithRelations }) {
  return (
    <div className="space-y-2 text-sm">
      <p className="text-muted-foreground">
        Submitted by {transaction.submittedBy.name ?? transaction.submittedBy.email}
      </p>
      {transaction.approvedBy && (
        <p className="text-muted-foreground">
          Approved by {transaction.approvedBy.name ?? transaction.approvedBy.email}
        </p>
      )}
      {transaction.rejectionReason && (
        <p className="text-destructive">Rejected: {transaction.rejectionReason}</p>
      )}
      {transaction.reimbursedAt && (
        <p className="text-muted-foreground">
          Reimbursed via {transaction.reimbursementMethod ?? "unspecified method"}
        </p>
      )}
      {transaction.reconciledBy && (
        <p className="text-muted-foreground">
          Reconciled by {transaction.reconciledBy.name ?? transaction.reconciledBy.email}
          {transaction.statementRef ? ` — ${transaction.statementRef}` : ""}
        </p>
      )}
      {transaction.voidedAt && <p className="text-destructive">Voided: {transaction.voidReason}</p>}
      <p className="text-muted-foreground text-xs">
        Full audit trail: {formatCents(transaction.amountCents)} · created{" "}
        {transaction.createdAt.toLocaleString()}
      </p>
    </div>
  );
}
