"use client";

import { TransactionKind } from "@/generated/prisma/enums";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const KIND_LABELS: Record<TransactionKind, string> = {
  EXPENSE: "Expense (reimbursement)",
  SPONSORSHIP: "Sponsorship",
  ALLOCATION: "Allocation",
  OTHER_INCOME: "Other income",
  ADJUSTMENT: "Adjustment",
};

export function TransactionKindSelect({
  value,
  onChange,
  disabled,
  restrictToExpense,
}: {
  value: TransactionKind;
  onChange: (value: TransactionKind) => void;
  disabled?: boolean;
  /** Members without finance access can only ever submit expenses. */
  restrictToExpense?: boolean;
}) {
  const options = restrictToExpense ? [TransactionKind.EXPENSE] : Object.values(TransactionKind);

  return (
    <Select value={value} onValueChange={(v) => onChange(v as TransactionKind)} disabled={disabled}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((k) => (
          <SelectItem key={k} value={k}>
            {KIND_LABELS[k]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
