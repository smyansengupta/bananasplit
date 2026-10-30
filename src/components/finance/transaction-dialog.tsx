"use client";

import {
  ArchiveRestore,
  Ban,
  Banknote,
  Check,
  Loader2,
  Lock,
  LockOpen,
  RotateCcw,
  Send,
  UserRound,
  X,
  type IconComponent,
} from "@/components/icons";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";

import {
  approveAndPayExpense,
  approveExpense,
  createTransaction,
  deleteTransaction,
  markExpenseNotApplicable,
  reconcileTransaction,
  rejectExpense,
  reimburseExpense,
  restoreTransaction,
  resubmitExpense,
  submitExpense,
  unlockTransaction,
  updateTransaction,
  withdrawExpense,
} from "@/app/app/[orgSlug]/finance/transactions-actions";
import {
  deleteReceiptAction,
  getSignedReceiptUrl,
} from "@/app/app/[orgSlug]/finance/receipts-actions";
import type { TransactionWithRelations } from "@/app/app/[orgSlug]/finance/queries";
import { lastPayMethod, PayMethodChips, rememberPayMethod } from "@/components/finance/pay-method";
import { ReceiptDrop, uploadReceipt, type ReceiptRead } from "@/components/finance/receipt-drop";
import { KIND_LABELS } from "@/components/finance/transaction-kind-select";
import { TransactionStatusBadge } from "@/components/finance/transaction-status-badge";
import { SavedMark, type FieldSaveStatus } from "@/components/ui/autosave";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useConfirm } from "@/components/ui/confirm-dialog";
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
import { metaLine } from "@/components/ui/meta-list";
import { Segmented } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toaster";
import { TransactionDirection, TransactionKind } from "@/generated/prisma/enums";
import { DELETED_TRANSACTION_REASON } from "@/lib/finance/deleted";
import { formatCents, parseDollarsToCents } from "@/lib/finance/money";
import { formatFinanceDate } from "@/lib/finance/stats";
import { cn } from "@/lib/utils";
import { toDateInputValue } from "@/components/tasks/utils";

/**
 * One transaction, on one screen (no tabs: the receipt and the history are
 * what you open a transaction to check, so they're shown, not hidden).
 *
 * New ones come in two shapes:
 * - a REQUEST to be paid back (any member, and "Request a reimbursement"):
 *   the receipt first, which fills in the rest when the club has an AI
 *   model, then one Submit that sends it straight to the treasurer;
 * - a RECORD (a treasurer's "Add transaction"): money in or out, which
 *   counts in the totals the moment it's saved.
 *
 * Saved ones save each field as it changes (no Save button). The
 * reimbursement step's button is the one primary action: Submit, Approve
 * and pay, Mark paid, or Send again after a rejection. Void takes a
 * transaction out of every list and total, with Undo.
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
        {open &&
          (transaction ? (
            <SavedTransaction
              key={transaction.id}
              transaction={transaction}
              onOpenChange={onOpenChange}
              {...rest}
            />
          ) : (
            <NewTransaction key="new" onOpenChange={onOpenChange} {...rest} />
          ))}
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

function Field({
  id,
  label,
  children,
  className,
}: {
  id: string;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid content-start gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function AmountInput({
  id,
  value,
  onChange,
  onBlur,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-sm">
        $
      </span>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        disabled={disabled}
        inputMode="decimal"
        placeholder="0.00"
        className="pl-7 tabular-nums"
      />
    </div>
  );
}

function CategorySelect({
  id,
  value,
  onChange,
  options,
  disabled,
}: {
  id: string;
  value: string | null;
  onChange: (v: string | null) => void;
  options: { id: string; name: string }[];
  disabled?: boolean;
}) {
  return (
    <Select
      value={value ?? "none"}
      onValueChange={(v) => onChange(v === "none" ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">No category</SelectItem>
        {options.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The kinds a new record can be, by direction. Sponsorships are recorded on Sponsorships. */
const KINDS_BY_DIRECTION: Record<TransactionDirection, TransactionKind[]> = {
  OUT: [TransactionKind.EXPENSE, TransactionKind.ALLOCATION, TransactionKind.ADJUSTMENT],
  IN: [TransactionKind.OTHER_INCOME, TransactionKind.ALLOCATION, TransactionKind.ADJUSTMENT],
};

const KIND_SHORT: Partial<Record<TransactionKind, string>> = {
  OTHER_INCOME: "Income",
};

// ------------------------------------------------------------------ new

function NewTransaction({
  orgId,
  onOpenChange,
  periods,
  categories,
  isFinance,
  request = false,
  onSaved,
}: Omit<Props, "open" | "transaction">) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const asRequest = !isFinance || request;

  const [direction, setDirection] = useState<TransactionDirection>(TransactionDirection.OUT);
  const [kind, setKind] = useState<TransactionKind>(TransactionKind.EXPENSE);
  const [budgetPeriodId, setBudgetPeriodId] = useState(periods[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [occurredAt, setOccurredAt] = useState(toDateInputValue(new Date()));
  const [receipt, setReceipt] = useState<File | null>(null);
  const [another, setAnother] = useState(false);
  const descriptionRef = useRef<HTMLInputElement>(null);

  const periodCategories = categories.filter((c) => c.budgetPeriodId === budgetPeriodId);

  // A member can't file before a treasurer has a budget period: say so up
  // front instead of after the form is filled in.
  if (asRequest && !isFinance && periods.length === 0) {
    return (
      <>
        <DialogHeader className="pr-8">
          <DialogTitle className="display-title text-2xl">Request a reimbursement</DialogTitle>
          <DialogDescription>
            Finance isn&apos;t set up yet. Ask your treasurer to open Finance once, then come back.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            OK
          </Button>
        </DialogFooter>
      </>
    );
  }

  /** Fills only what's still empty: the receipt never overwrites what was typed. */
  function fillFrom(read: ReceiptRead) {
    if (read.amount && !amount.trim()) setAmount(read.amount);
    if (read.date && /^\d{4}-\d{2}-\d{2}$/.test(read.date)) setOccurredAt(read.date);
    if (read.description && !description.trim()) {
      setDescription(read.counterparty ? `${read.description}` : read.description);
    }
    if (read.counterparty && !counterparty.trim()) setCounterparty(read.counterparty);
    if (read.category && !categoryId) {
      const match = periodCategories.find(
        (c) => c.name.toLowerCase() === read.category!.toLowerCase(),
      );
      if (match) setCategoryId(match.id);
    }
  }

  function save() {
    setError(null);
    startTransition(async () => {
      let amountCents: number;
      try {
        amountCents = parseDollarsToCents(amount);
      } catch {
        setError("Enter an amount, like 12.50.");
        return;
      }
      const result = await createTransaction(orgId, {
        budgetPeriodId: budgetPeriodId || null,
        categoryId,
        direction: asRequest ? TransactionDirection.OUT : direction,
        kind: asRequest ? TransactionKind.EXPENSE : kind,
        amountCents,
        description,
        counterparty: counterparty.trim() || null,
        occurredAt: new Date(occurredAt).toISOString(),
        paymentMethod: asRequest ? null : paymentMethod.trim() || null,
        purpose: asRequest ? "request" : "record",
      });
      if (result.error || !result.transactionId) {
        setError(result.error ?? "That didn't save. Try again.");
        return;
      }
      if (receipt) {
        const failed = await uploadReceipt(orgId, result.transactionId, receipt);
        if (failed)
          toast({ title: "Saved without the receipt", description: failed, tone: "error" });
      }
      onSaved?.();
      router.refresh();
      toast({ title: asRequest ? "Sent to the treasurer" : "Saved", tone: "success" });
      if (another) {
        // Keep the period, category and date: the next one is usually alike.
        setAmount("");
        setDescription("");
        setCounterparty("");
        setReceipt(null);
        descriptionRef.current?.focus();
        return;
      }
      onOpenChange(false);
    });
  }

  const ready = description.trim() && amount.trim();

  return (
    <>
      <DialogHeader className="pr-8">
        <DialogTitle className="display-title text-2xl">
          {asRequest ? "Request a reimbursement" : "New transaction"}
        </DialogTitle>
      </DialogHeader>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !isPending) save();
        }}
      >
        {!asRequest && (
          <Segmented
            label="Money in or out"
            value={direction}
            onSelect={(v) => {
              const next = v as TransactionDirection;
              setDirection(next);
              setKind(KINDS_BY_DIRECTION[next][0]!);
            }}
            options={[
              { value: TransactionDirection.OUT, label: "Money out" },
              { value: TransactionDirection.IN, label: "Money in" },
            ]}
          />
        )}

        {(asRequest || direction === TransactionDirection.OUT) && (
          <ReceiptDrop orgId={orgId} file={receipt} onFile={setReceipt} onRead={fillFrom} />
        )}

        <Field id="txn-description" label="What for">
          <Input
            ref={descriptionRef}
            id="txn-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
          />
        </Field>

        <div className="grid items-start gap-3 sm:grid-cols-2 [&>*]:content-start">
          <Field id="txn-amount" label="Amount">
            <AmountInput id="txn-amount" value={amount} onChange={setAmount} />
          </Field>
          <Field id="txn-date" label="Date">
            <Input
              id="txn-date"
              type="date"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid items-start gap-3 sm:grid-cols-2 [&>*]:content-start">
          <Field id="txn-category" label="Category">
            <CategorySelect
              id="txn-category"
              value={categoryId}
              onChange={setCategoryId}
              options={periodCategories}
            />
          </Field>
          {!asRequest && (
            <Field id="txn-counterparty" label={direction === "IN" ? "Paid by" : "Paid to"}>
              <Input
                id="txn-counterparty"
                value={counterparty}
                onChange={(e) => setCounterparty(e.target.value)}
              />
            </Field>
          )}
        </div>

        {!asRequest && (
          <>
            <Field id="txn-kind" label="Kind">
              <Segmented
                label="Kind"
                value={kind}
                onSelect={(v) => setKind(v as TransactionKind)}
                className="max-w-full overflow-x-auto"
                options={KINDS_BY_DIRECTION[direction].map((k) => ({
                  value: k,
                  label: KIND_SHORT[k] ?? KIND_LABELS[k],
                }))}
              />
            </Field>
            <div className="grid items-start gap-3 sm:grid-cols-2 [&>*]:content-start">
              <Field id="txn-payment-method" label="Paid with">
                <Input
                  id="txn-payment-method"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                />
              </Field>
              {periods.length > 1 && (
                <Field id="txn-period" label="Budget period">
                  <Select value={budgetPeriodId} onValueChange={setBudgetPeriodId}>
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
                </Field>
              )}
            </div>
          </>
        )}

        {error && <ErrorNotice>{error}</ErrorNotice>}

        <DialogFooter className="items-center pt-1">
          <label className="text-muted-foreground flex items-center gap-2 text-sm sm:mr-auto">
            <Checkbox checked={another} onCheckedChange={(v) => setAnother(v === true)} />
            Create another
          </label>
          <Button type="submit" disabled={isPending || !ready}>
            {isPending ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : asRequest ? (
              <Send aria-hidden="true" />
            ) : null}
            {asRequest ? "Submit" : "Create"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

// ------------------------------------------------------------------ saved

function SavedTransaction({
  orgId,
  onOpenChange,
  transaction,
  categories,
  isFinance,
  currentUserId,
  onSaved,
}: Omit<Props, "open" | "transaction" | "periods" | "request"> & {
  transaction: TransactionWithRelations;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<FieldSaveStatus>("idle");

  const isSubmitter = transaction.submittedById === currentUserId;
  const locked = Boolean(transaction.reconciledAt);
  const voided = Boolean(transaction.voidedAt);
  const isExpense = transaction.kind === "EXPENSE";
  const [resending, setResending] = useState(false);

  // Editing in place: finance on anything not locked or voided; a member on
  // their own draft. A rejected request is edited to send it again.
  const canEdit =
    !voided &&
    ((isFinance && !locked) || (isSubmitter && transaction.status === "DRAFT") || resending);
  const autosave = canEdit && !resending;

  const [categoryId, setCategoryId] = useState<string | null>(transaction.categoryId ?? null);
  const [amount, setAmount] = useState((transaction.amountCents / 100).toFixed(2));
  const [description, setDescription] = useState(transaction.description);
  const [counterparty, setCounterparty] = useState(transaction.counterparty ?? "");
  const [paymentMethod, setPaymentMethod] = useState(transaction.paymentMethod ?? "");
  const [occurredAt, setOccurredAt] = useState(toDateInputValue(transaction.occurredAt));
  const periodCategories = categories.filter(
    (c) => c.budgetPeriodId === transaction.budgetPeriodId,
  );

  const fade = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (fade.current && clearTimeout(fade.current)), []);

  /** Saves one change the moment it's made (text fields on blur). */
  async function commit(patch: Record<string, unknown>) {
    if (!autosave) return;
    setSaveStatus("saving");
    setError(null);
    const result = await updateTransaction(orgId, transaction.id, patch);
    if (result.error) {
      setSaveStatus("error");
      setError(result.error);
      return;
    }
    setSaveStatus("saved");
    if (fade.current) clearTimeout(fade.current);
    fade.current = setTimeout(() => setSaveStatus("idle"), 2_000);
    onSaved?.();
    router.refresh();
  }

  function commitAmount() {
    let cents: number;
    try {
      cents = parseDollarsToCents(amount);
    } catch {
      setError("Enter an amount, like 12.50.");
      return;
    }
    if (cents !== transaction.amountCents) void commit({ amountCents: cents });
  }

  function run(action: () => Promise<{ error?: string }>, done?: string) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result?.error) {
        setError(result.error);
        return;
      }
      if (done) toast({ title: done, tone: "success" });
      onSaved?.();
      router.refresh();
    });
  }

  function voidIt() {
    const id = transaction.id;
    setError(null);
    startTransition(async () => {
      const result = await deleteTransaction(orgId, id);
      if (result.error) {
        setError(result.error);
        return;
      }
      onOpenChange(false);
      onSaved?.();
      router.refresh();
      toast({
        title: "Voided",
        action: {
          label: "Undo",
          run: async () => {
            const back = await restoreTransaction(orgId, id);
            if (back.error) return back.error;
            router.refresh();
          },
        },
      });
    });
  }

  function sendAgain() {
    let cents: number;
    try {
      cents = parseDollarsToCents(amount);
    } catch {
      setError("Enter an amount, like 12.50.");
      return;
    }
    run(
      () =>
        resubmitExpense(orgId, transaction.id, {
          amountCents: cents,
          description,
          categoryId,
          occurredAt: new Date(occurredAt).toISOString(),
        }),
      "Sent again",
    );
    setResending(false);
  }

  // A member can void their own request until it's approved.
  const canVoid =
    !voided &&
    !locked &&
    (isFinance ||
      (isSubmitter &&
        isExpense &&
        (transaction.status === "DRAFT" || transaction.status === "SUBMITTED")));

  const meta = metaLine([
    KIND_LABELS[transaction.kind],
    `${transaction.direction === "IN" ? "+" : "−"}${formatCents(transaction.amountCents)}`,
    formatFinanceDate(transaction.occurredAt),
  ]);

  return (
    <>
      <DialogHeader className="gap-2.5 pr-8">
        <DialogTitle className="display-title text-2xl break-words">
          {transaction.description.trim() || "Transaction"}
        </DialogTitle>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <TransactionStatusBadge status={transaction.status} />
          {voided && <Badge variant="destructive">Voided</Badge>}
          {locked && (
            <Badge variant="secondary">
              <Lock aria-hidden="true" />
              Reconciled
            </Badge>
          )}
          <DialogDescription className="figure">{meta}</DialogDescription>
          {autosave && <SavedMark status={saveStatus} className="ms-auto" />}
        </div>
      </DialogHeader>

      {transaction.status === "REJECTED" && transaction.rejectionReason && (
        <p className="bg-tint-danger text-tint-danger-foreground rounded-tile p-3 text-sm">
          Not approved: {transaction.rejectionReason}
        </p>
      )}

      <div className="space-y-4">
        <Field id="txn-description" label="What for">
          <Input
            id="txn-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => {
              if (description.trim() && description !== transaction.description) {
                void commit({ description });
              }
            }}
            disabled={!canEdit}
            maxLength={500}
          />
        </Field>
        <div className="grid items-start gap-3 sm:grid-cols-2 [&>*]:content-start">
          <Field id="txn-amount" label="Amount">
            <AmountInput
              id="txn-amount"
              value={amount}
              onChange={setAmount}
              onBlur={autosave ? commitAmount : undefined}
              disabled={!canEdit}
            />
          </Field>
          <Field id="txn-date" label="Date">
            <Input
              id="txn-date"
              type="date"
              value={occurredAt}
              onChange={(e) => {
                setOccurredAt(e.target.value);
                if (e.target.value) {
                  void commit({ occurredAt: new Date(e.target.value).toISOString() });
                }
              }}
              disabled={!canEdit}
            />
          </Field>
        </div>
        <div className="grid items-start gap-3 sm:grid-cols-2 [&>*]:content-start">
          <Field id="txn-category" label="Category">
            <CategorySelect
              id="txn-category"
              value={categoryId}
              onChange={(v) => {
                setCategoryId(v);
                void commit({ categoryId: v });
              }}
              options={periodCategories}
              disabled={!canEdit}
            />
          </Field>
          {(isFinance || transaction.counterparty) && (
            <Field
              id="txn-counterparty"
              label={transaction.direction === "IN" ? "Paid by" : "Paid to"}
            >
              <Input
                id="txn-counterparty"
                value={counterparty}
                onChange={(e) => setCounterparty(e.target.value)}
                onBlur={() => {
                  if (counterparty !== (transaction.counterparty ?? "")) {
                    void commit({ counterparty: counterparty.trim() || null });
                  }
                }}
                disabled={!canEdit || !isFinance}
              />
            </Field>
          )}
        </div>
        {isFinance && transaction.status === "NOT_APPLICABLE" && (
          <Field id="txn-payment-method" label="Paid with">
            <Input
              id="txn-payment-method"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              onBlur={() => {
                if (paymentMethod !== (transaction.paymentMethod ?? "")) {
                  void commit({ paymentMethod: paymentMethod.trim() || null });
                }
              }}
              disabled={!canEdit}
            />
          </Field>
        )}
      </div>

      <Receipts orgId={orgId} transaction={transaction} onChanged={() => router.refresh()} />

      {error && <ErrorNotice>{error}</ErrorNotice>}

      {isExpense && !locked && !voided && (
        <ExpenseStep
          orgId={orgId}
          transaction={transaction}
          isFinance={isFinance}
          isSubmitter={isSubmitter}
          pending={isPending}
          resending={resending}
          onResend={() => setResending(true)}
          onSendAgain={sendAgain}
          run={run}
        />
      )}

      {isFinance && <History transaction={transaction} />}

      <DialogFooter className="flex-row flex-wrap items-center gap-2 pt-1 sm:justify-start">
        {canVoid && (
          <Button
            type="button"
            variant="ghost"
            className="text-tint-danger-foreground"
            disabled={isPending}
            onClick={voidIt}
          >
            <Ban aria-hidden="true" />
            Void
          </Button>
        )}
        {voided && isFinance && (
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => run(() => restoreTransaction(orgId, transaction.id), "Restored")}
          >
            <ArchiveRestore aria-hidden="true" />
            Restore
          </Button>
        )}
        {isFinance && !voided && (
          <Button
            type="button"
            variant="ghost"
            className="sm:ms-auto"
            disabled={isPending}
            onClick={() =>
              run(
                () =>
                  locked
                    ? unlockTransaction(orgId, transaction.id)
                    : reconcileTransaction(orgId, transaction.id),
                locked ? "Unlocked" : "Reconciled",
              )
            }
          >
            {locked ? <LockOpen aria-hidden="true" /> : <Lock aria-hidden="true" />}
            {locked ? "Unlock" : "Reconcile"}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

/**
 * Where a reimbursement stands and the one thing to do next. Approving and
 * paying is one step when the treasurer pays straight away (the usual case);
 * Approve alone stays for "yes, I'll pay later".
 */
function ExpenseStep({
  orgId,
  transaction,
  isFinance,
  isSubmitter,
  pending,
  resending,
  onResend,
  onSendAgain,
  run,
}: {
  orgId: string;
  transaction: TransactionWithRelations;
  isFinance: boolean;
  isSubmitter: boolean;
  pending: boolean;
  resending: boolean;
  onResend: () => void;
  onSendAgain: () => void;
  run: (action: () => Promise<{ error?: string }>, done?: string) => void;
}) {
  // The dialog only renders in the browser, after a click, so this can read storage.
  const [method, setMethod] = useState(lastPayMethod);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const status = transaction.status;
  const reviewer = isFinance && !isSubmitter;

  const pay = (action: () => Promise<{ error?: string }>) => {
    rememberPayMethod(method);
    run(action, "Paid");
  };

  let line: string | null = null;
  let body: ReactNode = null;

  if (status === "DRAFT" && isSubmitter) {
    line = "Draft";
    body = (
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending}
          onClick={() => run(() => submitExpense(orgId, transaction.id), "Sent to the treasurer")}
        >
          <Send aria-hidden="true" />
          Submit
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => run(() => markExpenseNotApplicable(orgId, transaction.id))}
        >
          Don&apos;t pay back
        </Button>
      </div>
    );
  } else if (status === "SUBMITTED" && reviewer) {
    line = "Waiting for approval";
    body = rejecting ? null : (
      <div className="space-y-3">
        <PayMethodChips value={method} onChange={setMethod} />
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={pending || !method.trim()}
            onClick={() => pay(() => approveAndPayExpense(orgId, transaction.id, method))}
          >
            <Banknote aria-hidden="true" />
            Approve and pay
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => run(() => approveExpense(orgId, transaction.id), "Approved")}
          >
            <Check aria-hidden="true" />
            Approve
          </Button>
          <Button variant="ghost" disabled={pending} onClick={() => setRejecting(true)}>
            <X aria-hidden="true" />
            Reject
          </Button>
        </div>
      </div>
    );
  } else if (status === "SUBMITTED" && isSubmitter) {
    line = "Waiting for approval";
    body = (
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => run(() => withdrawExpense(orgId, transaction.id))}
      >
        <RotateCcw aria-hidden="true" />
        Withdraw
      </Button>
    );
  } else if (status === "APPROVED" && reviewer) {
    line = "Approved";
    body = rejecting ? null : (
      <div className="space-y-3">
        <PayMethodChips value={method} onChange={setMethod} />
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={pending || !method.trim()}
            onClick={() => pay(() => reimburseExpense(orgId, transaction.id, method))}
          >
            <Banknote aria-hidden="true" />
            Mark paid
          </Button>
          <Button variant="ghost" disabled={pending} onClick={() => setRejecting(true)}>
            <X aria-hidden="true" />
            Reject
          </Button>
        </div>
      </div>
    );
  } else if (status === "APPROVED") {
    line = "Approved, payment on the way";
  } else if (status === "REIMBURSED") {
    line = transaction.reimbursementMethod
      ? `Paid back with ${transaction.reimbursementMethod}`
      : "Paid back";
  } else if (status === "REJECTED" && isSubmitter) {
    line = resending ? "Fix it, then send it again" : null;
    body = resending ? (
      <Button disabled={pending} onClick={onSendAgain}>
        <Send aria-hidden="true" />
        Send again
      </Button>
    ) : (
      <Button variant="outline" disabled={pending} onClick={onResend}>
        Edit and resend
      </Button>
    );
  }

  if (!line && !body) return null;
  return (
    <section aria-label="Reimbursement" className="bg-muted/60 rounded-tile space-y-3 p-4">
      {line && <p className="heading text-sm">{line}</p>}
      {rejecting ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim()) run(() => rejectExpense(orgId, transaction.id, reason), "Rejected");
          }}
        >
          <Field id="reject-reason" label="Reason">
            <Input
              id="reject-reason"
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setRejecting(false)}>
              Back
            </Button>
            <Button type="submit" variant="destructive" disabled={pending || !reason.trim()}>
              Reject
            </Button>
          </div>
        </form>
      ) : (
        body
      )}
    </section>
  );
}

function Receipts({
  orgId,
  transaction,
  onChanged,
}: {
  orgId: string;
  transaction: TransactionWithRelations;
  onChanged: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [confirmEl, confirm] = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  function attach(next: File | null) {
    if (!next) return;
    setFile(next);
    setError(null);
    startTransition(async () => {
      const failed = await uploadReceipt(orgId, transaction.id, next);
      setFile(null);
      if (failed) setError(failed);
      else onChanged();
    });
  }

  async function view(receiptId: string) {
    const result = await getSignedReceiptUrl(orgId, receiptId);
    if (result.url) window.open(result.url, "_blank", "noopener,noreferrer");
  }

  // The file is deleted for good (no trash for receipts), so this one asks.
  async function remove(receiptId: string, filename: string) {
    const ok = await confirm({
      title: `Delete ${filename}?`,
      confirmLabel: "Delete",
      run: async () => (await deleteReceiptAction(orgId, receiptId))?.error,
    });
    if (ok) onChanged();
  }

  return (
    <section aria-label="Receipts" className="space-y-2">
      {transaction.receipts.length > 0 && (
        <ul className="divide-border/70 -mx-2 divide-y">
          {transaction.receipts.map((r) => (
            <li
              key={r.id}
              className="hover:bg-muted/60 rounded-field flex items-center gap-3 px-2 py-2 transition-colors"
            >
              <span
                aria-hidden="true"
                className="bg-receipt ring-foreground/10 h-10 w-8 shrink-0 rounded-[6px] ring-1"
              />
              <button
                type="button"
                onClick={() => void view(r.id)}
                className="focus-glow min-w-0 flex-1 rounded-sm text-left text-sm font-medium break-words underline-offset-3 hover:underline"
              >
                {r.filename}
              </button>
              <button
                type="button"
                aria-label={`Delete ${r.filename}`}
                disabled={isPending}
                onClick={() => void remove(r.id, r.filename)}
                className="text-muted-foreground hover:text-tint-danger-foreground hover:bg-tint-danger grid size-8 shrink-0 place-items-center rounded-full"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <ReceiptDrop orgId={orgId} file={file} onFile={attach} />
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {confirmEl}
    </section>
  );
}

function HistoryRow({
  icon: Icon,
  tone,
  children,
}: {
  icon: IconComponent;
  tone?: "danger";
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <span
        aria-hidden="true"
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-full",
          tone === "danger"
            ? "bg-tint-danger text-tint-danger-foreground"
            : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-3" />
      </span>
      <span
        className={cn(
          "min-w-0 pt-0.5 text-[13px]",
          tone === "danger" && "text-tint-danger-foreground",
        )}
      >
        {children}
      </span>
    </li>
  );
}

const nameOf = (u: { name: string | null; email: string }) => u.name?.trim() || u.email;

/** Who did what to it, for the treasurer: short, and always shown. */
function History({ transaction }: { transaction: TransactionWithRelations }) {
  return (
    <ul aria-label="History" className="border-border/70 border-t pt-2">
      <HistoryRow icon={UserRound}>
        Added by {nameOf(transaction.submittedBy)}, {formatFinanceDate(transaction.createdAt)}
      </HistoryRow>
      {transaction.approvedBy && (
        <HistoryRow icon={Check}>Approved by {nameOf(transaction.approvedBy)}</HistoryRow>
      )}
      {transaction.rejectionReason && (
        <HistoryRow icon={X} tone="danger">
          Rejected: {transaction.rejectionReason}
        </HistoryRow>
      )}
      {transaction.reimbursedAt && (
        <HistoryRow icon={Banknote}>
          Paid back
          {transaction.reimbursementMethod ? ` with ${transaction.reimbursementMethod}` : ""}
        </HistoryRow>
      )}
      {transaction.reconciledBy && (
        <HistoryRow icon={Lock}>
          Reconciled by {nameOf(transaction.reconciledBy)}
          {transaction.statementRef ? `, ${transaction.statementRef}` : ""}
        </HistoryRow>
      )}
      {transaction.voidedAt && (
        <HistoryRow icon={Ban} tone="danger">
          Voided
          {transaction.voidReason && transaction.voidReason !== DELETED_TRANSACTION_REASON
            ? `: ${transaction.voidReason}`
            : ""}
        </HistoryRow>
      )}
    </ul>
  );
}
