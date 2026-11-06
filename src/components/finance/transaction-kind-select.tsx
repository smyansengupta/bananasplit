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
  EXPENSE: "Expense",
  SPONSORSHIP: "Deal",
  ALLOCATION: "Allocation",
  OTHER_INCOME: "Other income",
  ADJUSTMENT: "Adjustment",
};

/** The kind picker: a 40px field like every other input in the transaction dialog. */
export function TransactionKindSelect({
  id,
  value,
  onChange,
  disabled,
  restrictToExpense,
}: {
  /** For a <Label htmlFor>. */
  id?: string;
  value: TransactionKind;
  onChange: (value: TransactionKind) => void;
  disabled?: boolean;
  /** Members without finance access can only ever submit expenses. */
  restrictToExpense?: boolean;
}) {
  const options = restrictToExpense ? [TransactionKind.EXPENSE] : Object.values(TransactionKind);

  return (
    <Select value={value} onValueChange={(v) => onChange(v as TransactionKind)} disabled={disabled}>
      <SelectTrigger id={id} className="w-full">
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
