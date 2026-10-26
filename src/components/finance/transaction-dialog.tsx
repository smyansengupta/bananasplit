"use client";

import {
  ArchiveRestore,
  Ban,
  Banknote,
  Check,
  Loader2,
  Lock,
  Trash2,
  Upload,
  UserRound,
  X,
  type IconComponent,
} from "@/components/icons";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type ReactNode } from "react";

import {
  approveExpense,
  createTransaction,
  deleteTransaction,
  markExpenseNotApplicable,
  reconcileTransaction,
  rejectExpense,
  reimburseExpense,
  restoreTransaction,
  submitExpense,
  unlockTransaction,
  updateTransaction,
  voidTransaction,
  withdrawExpense,
} from "@/app/app/[orgSlug]/finance/transactions-actions";
import {
  deleteReceiptAction,
  getSignedReceiptUrl,
} from "@/app/app/[orgSlug]/finance/receipts-actions";
import type { TransactionWithRelations } from "@/app/app/[orgSlug]/finance/queries";
import { KIND_LABELS, TransactionKindSelect } from "@/components/finance/transaction-kind-select";
import { TransactionStatusBadge } from "@/components/finance/transaction-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toaster";
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
import { MAX_UPLOAD_BYTES, prepareReceiptForUpload } from "@/lib/finance/prepare-receipt";
import { formatFinanceDate } from "@/lib/finance/stats";
import { cn } from "@/lib/utils";
import { toDateInputValue } from "@/components/tasks/utils";

/**
 * One transaction (Moonstone): a dialog with the title in the display face
 * and its status chips under it; Details, Receipts and (for the treasurer)
 * Activity as a pill track. Each state has one primary commit (Save, or the
 * reimbursement step: Submit, Approve, Mark reimbursed) and at most one red
 * button, naming the thing ("Delete transaction", "Reject request").
 */

interface Props {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: TransactionWithRelations | null;
  periods: { id: string; label: string }[];
  categories: { id: string; name: string; budgetPeriodId: string }[];
  isFinance: boolean;
  /** A new entry as a reimbursement request: an expense only, whoever opens it. */
  request?: boolean;
  currentUserId: string;
  onSaved?: () => void;
}

export function TransactionDialog({ open, onOpenChange, transaction, ...rest }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-5 overflow-y-auto sm:max-w-xl">
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

/** An error said in the danger tint. */
function ErrorNotice({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="bg-tint-danger text-tint-danger-foreground rounded-tile p-3 text-sm">
      {children}
    </p>
  );
}

function TransactionForm({
  orgId,
  onOpenChange,
  transaction,
  periods,
  categories,
  isFinance,
  request = false,
  currentUserId,
  onSaved,
}: Omit<Props, "open">) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // A reason prompt (reject, void, reconcile, unlock) is open in the details.
  const [prompting, setPrompting] = useState(false);

  const restrictToExpense = !isFinance || request;
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

  // Delete (a void the lists hide, with Undo): finance on anything not
  // locked; a member on their own request until it's approved.
  const canDelete =
    Boolean(transaction) &&
    !transaction?.reconciledAt &&
    (isFinance ||
      (transaction?.submittedById === currentUserId &&
        transaction?.kind === "EXPENSE" &&
        (transaction?.status === "DRAFT" || transaction?.status === "SUBMITTED")));

  // The reimbursement step's button (Submit, Approve, Mark reimbursed; see
  // ExpenseActions) is this state's primary commit; Save steps back then.
  const isSubmitter = transaction?.submittedById === currentUserId;
  const flowPrimary =
    transaction !== null &&
    transaction.kind === "EXPENSE" &&
    !transaction.reconciledAt &&
    ((transaction.status === "DRAFT" && isSubmitter) ||
      ((transaction.status === "SUBMITTED" || transaction.status === "APPROVED") &&
        isFinance &&
        !isSubmitter));
  const [confirmEl, confirm] = useConfirm();

  async function remove() {
    if (!transaction) return;
    const ok = await confirm({
      title: `Delete “${transaction.description}”?`,
      description:
        "It comes out of every list and total. The finance activity log keeps a record, and you can undo this right after.",
      confirmLabel: "Delete transaction",
      run: async () => (await deleteTransaction(orgId, transaction.id)).error,
    });
    if (!ok) return;
    onOpenChange(false);
    onSaved?.();
    router.refresh();
    const id = transaction.id;
    toast({
      title: "Transaction deleted",
      description: transaction.description,
      action: {
        label: "Undo",
        run: async () => {
          const result = await restoreTransaction(orgId, id);
          if (result.error) return result.error;
          router.refresh();
        },
      },
    });
  }

  function restore() {
    if (!transaction) return;
    setError(null);
    startTransition(async () => {
      const result = await restoreTransaction(orgId, transaction.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast({ title: "Transaction restored", tone: "success" });
      onOpenChange(false);
      router.refresh();
    });
  }

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
      {/* A new request can only be an expense: no one-choice picker (the description says so). */}
      <div className={cn("grid gap-2", restrictToExpense && !transaction && "hidden")}>
        <Label htmlFor="txn-kind">Kind</Label>
        <TransactionKindSelect
          id="txn-kind"
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
        <div className="grid gap-2">
          <Label htmlFor="txn-direction">Direction</Label>
          <Select
            value={direction}
            onValueChange={(v) => setDirection(v as TransactionDirection)}
            disabled={!canEditFields}
          >
            <SelectTrigger id="txn-direction" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="IN">Money in</SelectItem>
              <SelectItem value="OUT">Money out</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid gap-2">
        <Label htmlFor="txn-description">Description</Label>
        <Textarea
          id="txn-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={!canEditFields}
          rows={2}
          className="min-h-16"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="txn-amount">Amount</Label>
          <div className="relative">
            <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-sm">
              $
            </span>
            <Input
              id="txn-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={!canEditFields}
              inputMode="decimal"
              placeholder="0.00"
              className="pl-7 tabular-nums"
            />
          </div>
        </div>
        <div className="grid gap-2">
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

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="txn-period">Budget period</Label>
          {periods.length === 0 ? (
            <p className="text-muted-foreground bg-muted/60 rounded-field flex min-h-10 items-center px-3.5 py-2 text-sm">
              This school year: it&apos;s set up when you save.
            </p>
          ) : (
            <Select
              value={budgetPeriodId}
              onValueChange={setBudgetPeriodId}
              // A saved transaction never moves between periods (the server
              // ignores budgetPeriodId on update), so the picker is fixed then.
              disabled={!canEditFields || Boolean(transaction)}
            >
              <SelectTrigger id="txn-period" className="w-full">
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
          )}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="txn-category">Category</Label>
          <Select
            value={categoryId ?? "none"}
            onValueChange={(v) => setCategoryId(v === "none" ? null : v)}
            disabled={!canEditFields}
          >
            <SelectTrigger id="txn-category" className="w-full">
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

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="txn-counterparty">Counterparty</Label>
          <Input
            id="txn-counterparty"
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
            disabled={!canEditFields}
            placeholder="Who was paid / who paid us"
          />
        </div>
        <div className="grid gap-2">
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

      {error && <ErrorNotice>{error}</ErrorNotice>}
    </div>
  );

  const title = transaction
    ? transaction.description.trim() || "Transaction"
    : restrictToExpense
      ? "Request a reimbursement"
      : "New transaction";

  return (
    <>
      <DialogHeader className="gap-2.5 pr-8">
        <DialogTitle className="display-title line-clamp-2 text-2xl">{title}</DialogTitle>
        {transaction ? (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <TransactionStatusBadge status={transaction.status} />
            {transaction.voidedAt && <Badge variant="destructive">Voided</Badge>}
            {transaction.reconciledAt && (
              <Badge variant="secondary">
                <Lock aria-hidden="true" />
                Reconciled
              </Badge>
            )}
            <DialogDescription className="figure">
              {KIND_LABELS[transaction.kind]} · {transaction.direction === "IN" ? "+" : "−"}
              {formatCents(transaction.amountCents)} · {formatFinanceDate(transaction.occurredAt)}
            </DialogDescription>
          </div>
        ) : (
          <DialogDescription>
            {restrictToExpense
              ? "What you bought for the club. A treasurer approves it and pays you back."
              : "Money in or out of the club's books."}
          </DialogDescription>
        )}
      </DialogHeader>

      {transaction ? (
        <Tabs defaultValue="details" className="gap-4">
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="receipts">
              Receipts
              <span className="text-muted-foreground tabular-nums">
                {transaction.receipts.length}
              </span>
            </TabsTrigger>
            {isFinance && <TabsTrigger value="activity">Activity</TabsTrigger>}
          </TabsList>
          <TabsContent value="details" className="space-y-4">
            {fieldsForm}
            <ExpenseActions
              orgId={orgId}
              transaction={transaction}
              isFinance={isFinance}
              currentUserId={currentUserId}
              onPromptChange={setPrompting}
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

      <DialogFooter className="pt-1">
        {transaction && !transaction.voidedAt && canDelete && !prompting && (
          <Button
            type="button"
            variant="destructive"
            className="sm:mr-auto"
            disabled={isPending}
            onClick={() => void remove()}
          >
            <Trash2 aria-hidden="true" />
            Delete transaction
          </Button>
        )}
        {transaction?.voidedAt && isFinance && (
          <Button
            type="button"
            variant="outline"
            className="sm:mr-auto"
            disabled={isPending}
            onClick={restore}
          >
            <ArchiveRestore aria-hidden="true" />
            Restore
          </Button>
        )}
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Close
        </Button>
        {canEditFields && !prompting && (
          <Button
            type="button"
            variant={flowPrimary ? "outline" : "default"}
            onClick={handleSave}
            disabled={isPending || !description.trim()}
          >
            {isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
            {transaction ? "Save" : "Create"}
          </Button>
        )}
      </DialogFooter>
      {confirmEl}
    </>
  );
}

type PendingReasonAction = "REJECT" | "VOID" | "UNLOCK" | "RECONCILE";

const REASON_PROMPT: Record<
  PendingReasonAction,
  { label: string; required: boolean; confirm: string; destructive: boolean }
> = {
  REJECT: {
    label: "Reason for rejecting this expense",
    required: true,
    confirm: "Reject request",
    destructive: true,
  },
  VOID: {
    label: "Reason for voiding this transaction",
    required: true,
    confirm: "Void transaction",
    destructive: true,
  },
  UNLOCK: {
    label: "Reason for unlocking this reconciled transaction",
    required: true,
    confirm: "Unlock",
    destructive: false,
  },
  RECONCILE: {
    label: "Statement reference (optional)",
    required: false,
    confirm: "Reconcile",
    destructive: false,
  },
};

/** What the reimbursement step means, in a line, for the tile above its buttons. */
function flowLine(status: TransactionWithRelations["status"], isFinance: boolean, mine: boolean) {
  switch (status) {
    case "DRAFT":
      return mine
        ? "A draft. Submit it when the receipt is attached, and a treasurer approves it."
        : "A draft: the member hasn't sent it yet.";
    case "SUBMITTED":
      return isFinance && !mine
        ? "Waiting on a treasurer's approval."
        : "Sent. A treasurer approves it next; you can withdraw it until then.";
    case "APPROVED":
      return isFinance && !mine
        ? "Approved. Pay it back, then mark it reimbursed with how you paid."
        : "Approved. A treasurer pays you back next.";
    case "REIMBURSED":
      return "Paid back.";
    case "REJECTED":
      return "Not approved.";
    default:
      return null;
  }
}

function ExpenseActions({
  orgId,
  transaction,
  isFinance,
  currentUserId,
  onPromptChange,
  onDone,
}: {
  orgId: string;
  transaction: TransactionWithRelations;
  isFinance: boolean;
  currentUserId: string;
  onPromptChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reimburseMethod, setReimburseMethod] = useState("");
  const [pendingAction, setPendingActionState] = useState<PendingReasonAction | null>(null);
  const [reasonText, setReasonText] = useState("");

  const setPendingAction = (action: PendingReasonAction | null) => {
    setPendingActionState(action);
    onPromptChange(action !== null);
  };

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
      <form
        className="bg-muted/60 rounded-tile space-y-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!isPending && (!prompt.required || reasonText.trim())) confirmReasonAction();
        }}
      >
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <div className="grid gap-2">
          <Label htmlFor="reason-text">{prompt.label}</Label>
          <Input
            id="reason-text"
            autoFocus
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setPendingAction(null);
              setReasonText("");
            }}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant={prompt.destructive ? "destructive" : "default"}
            disabled={isPending || (prompt.required && !reasonText.trim())}
          >
            {isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
            {prompt.confirm}
          </Button>
        </div>
      </form>
    );
  }

  const showFlow = isExpense && !locked;
  const line = showFlow ? flowLine(transaction.status, isFinance, isSubmitter) : null;
  const canSubmit = transaction.status === "DRAFT" && isSubmitter;
  const canMarkNa = transaction.status === "DRAFT" && (isSubmitter || isFinance);
  const canWithdraw = transaction.status === "SUBMITTED" && isSubmitter;
  const canReview =
    (transaction.status === "SUBMITTED" || transaction.status === "APPROVED") &&
    isFinance &&
    !isSubmitter;
  const canReimburse = transaction.status === "APPROVED" && isFinance && !isSubmitter;
  const hasFlowButtons = canSubmit || canMarkNa || canWithdraw || canReview;

  if (!showFlow && !isFinance) return null;

  return (
    <div className="space-y-3">
      {error && <ErrorNotice>{error}</ErrorNotice>}

      {showFlow && (line || hasFlowButtons) && (
        <section aria-label="Reimbursement" className="bg-muted/60 rounded-tile space-y-3 p-4">
          {line && (
            <p className="text-sm">
              <span className="heading">Reimbursement</span>
              <span className="text-muted-foreground"> · {line}</span>
            </p>
          )}
          {hasFlowButtons && (
            <div className="flex flex-wrap items-center gap-2">
              {canReimburse && (
                <Input
                  placeholder="Reimbursement method"
                  aria-label="Reimbursement method (Venmo, check, cash…)"
                  value={reimburseMethod}
                  onChange={(e) => setReimburseMethod(e.target.value)}
                  className="w-full sm:w-56"
                />
              )}
              {canSubmit && (
                <Button
                  disabled={isPending}
                  onClick={() => run(() => submitExpense(orgId, transaction.id))}
                >
                  Submit
                </Button>
              )}
              {transaction.status === "SUBMITTED" && canReview && (
                <Button
                  disabled={isPending}
                  onClick={() => run(() => approveExpense(orgId, transaction.id))}
                >
                  <Check aria-hidden="true" />
                  Approve
                </Button>
              )}
              {canReimburse && (
                <Button
                  disabled={isPending || !reimburseMethod.trim()}
                  onClick={() =>
                    run(() => reimburseExpense(orgId, transaction.id, reimburseMethod))
                  }
                >
                  <Banknote aria-hidden="true" />
                  Mark reimbursed
                </Button>
              )}
              {canMarkNa && (
                <Button
                  variant="outline"
                  disabled={isPending}
                  onClick={() => run(() => markExpenseNotApplicable(orgId, transaction.id))}
                >
                  Mark not applicable
                </Button>
              )}
              {canWithdraw && (
                <Button
                  variant="outline"
                  disabled={isPending}
                  onClick={() => run(() => withdrawExpense(orgId, transaction.id))}
                >
                  Withdraw
                </Button>
              )}
              {canReview && (
                <Button
                  variant="outline"
                  disabled={isPending}
                  onClick={() => setPendingAction("REJECT")}
                >
                  Reject
                </Button>
              )}
            </div>
          )}
        </section>
      )}

      {isFinance && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow text-muted-foreground mr-1">Books</span>
          {!locked ? (
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => setPendingAction("RECONCILE")}
            >
              <Lock aria-hidden="true" />
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
          {!locked && !transaction.voidedAt && (
            <Button
              size="sm"
              variant="ghost"
              disabled={isPending}
              onClick={() => setPendingAction("VOID")}
            >
              <Ban aria-hidden="true" />
              Void
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
  const [confirmReceiptEl, confirmReceipt] = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleUpload(file: File) {
    setError(null);
    startTransition(async () => {
      // Photos over 4 MB are downscaled in the browser first (0A Fix 15).
      let prepared: File;
      try {
        prepared = await prepareReceiptForUpload(file);
      } catch {
        prepared = file;
      }
      if (prepared.size > MAX_UPLOAD_BYTES) {
        setError("Receipts are capped at 4 MB. Try a smaller photo or a compressed PDF.");
        return;
      }
      const formData = new FormData();
      formData.set("transactionId", transaction.id);
      formData.set("file", prepared);
      try {
        const response = await fetch(`/api/orgs/${orgId}/receipts`, {
          method: "POST",
          body: formData,
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          setError(body?.error ?? "The upload failed. Try again.");
          return;
        }
      } catch {
        setError("The upload failed. Check your connection and try again.");
        return;
      }
      onChanged();
    });
  }

  async function handleView(receiptId: string) {
    const result = await getSignedReceiptUrl(orgId, receiptId);
    if (result.url) window.open(result.url, "_blank", "noopener,noreferrer");
  }

  async function handleDelete(receiptId: string, filename: string) {
    const ok = await confirmReceipt({
      title: `Remove the receipt “${filename}”?`,
      description: "The file is deleted for good. The transaction stays.",
      confirmLabel: "Remove receipt",
      run: async () => (await deleteReceiptAction(orgId, receiptId))?.error,
    });
    if (ok) onChanged();
  }

  const uploadButton = (
    <Button
      type="button"
      variant="outline"
      disabled={isPending}
      onClick={() => inputRef.current?.click()}
    >
      {isPending ? (
        <Loader2 className="animate-spin" aria-hidden="true" />
      ) : (
        <Upload aria-hidden="true" />
      )}
      Upload receipt
    </Button>
  );

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
      {error && <ErrorNotice>{error}</ErrorNotice>}

      {confirmReceiptEl}
      {transaction.receipts.length === 0 ? (
        <div className="rounded-block border-border flex flex-col items-center gap-3 border-[1.5px] border-dashed px-6 py-8 text-center">
          {/* A blank receipt: the ruled paper look receipts keep. */}
          <span
            aria-hidden="true"
            className="bg-receipt ring-foreground/10 h-12 w-10 rounded-[6px] opacity-80 ring-1"
          />
          <div className="space-y-1">
            <p className="heading text-sm">No receipt yet</p>
            <p className="text-muted-foreground text-[13px]">
              A photo or PDF, up to 4 MB. Treasurers check it before paying back.
            </p>
          </div>
          {uploadButton}
        </div>
      ) : (
        <>
          <ul className="divide-border/70 -mx-2 divide-y">
            {transaction.receipts.map((r) => (
              <li
                key={r.id}
                className="hover:bg-muted/60 rounded-field flex items-center gap-3 px-2 py-2 transition-colors"
              >
                {/* Receipts keep their ruled-paper stripes. */}
                <span
                  aria-hidden="true"
                  className="bg-receipt ring-foreground/10 h-10 w-8 shrink-0 rounded-[6px] ring-1"
                />
                <button
                  type="button"
                  onClick={() => handleView(r.id)}
                  className="focus-glow min-w-0 flex-1 truncate rounded-sm text-left text-sm font-medium underline-offset-3 hover:underline"
                >
                  {r.filename}
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleDelete(r.id, r.filename)}
                  disabled={isPending}
                  className="text-muted-foreground"
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          {uploadButton}
        </>
      )}
    </div>
  );
}

function ActivityRow({
  icon: Icon,
  tone,
  children,
}: {
  icon: IconComponent;
  tone?: "danger";
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span
        aria-hidden="true"
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full",
          tone === "danger"
            ? "bg-tint-danger text-tint-danger-foreground"
            : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <span
        className={cn("min-w-0 pt-1 text-sm", tone === "danger" && "text-tint-danger-foreground")}
      >
        {children}
      </span>
    </li>
  );
}

function ActivityPanel({ transaction }: { transaction: TransactionWithRelations }) {
  return (
    <div className="space-y-2">
      <ul className="divide-border/70 divide-y">
        <ActivityRow icon={UserRound}>
          Submitted by {transaction.submittedBy.name ?? transaction.submittedBy.email}
        </ActivityRow>
        {transaction.approvedBy && (
          <ActivityRow icon={Check}>
            Approved by {transaction.approvedBy.name ?? transaction.approvedBy.email}
          </ActivityRow>
        )}
        {transaction.rejectionReason && (
          <ActivityRow icon={X} tone="danger">
            Rejected: {transaction.rejectionReason}
          </ActivityRow>
        )}
        {transaction.reimbursedAt && (
          <ActivityRow icon={Banknote}>
            Reimbursed via {transaction.reimbursementMethod ?? "unspecified method"}
          </ActivityRow>
        )}
        {transaction.reconciledBy && (
          <ActivityRow icon={Lock}>
            Reconciled by {transaction.reconciledBy.name ?? transaction.reconciledBy.email}
            {transaction.statementRef ? ` · ${transaction.statementRef}` : ""}
          </ActivityRow>
        )}
        {transaction.voidedAt && (
          <ActivityRow icon={Ban} tone="danger">
            Voided: {transaction.voidReason}
          </ActivityRow>
        )}
      </ul>
      <p className="text-muted-foreground figure text-[13px]">
        Full audit trail: {formatCents(transaction.amountCents)} · created{" "}
        {transaction.createdAt.toLocaleString()}
      </p>
    </div>
  );
}
