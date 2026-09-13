import { Badge } from "@/components/ui/badge";
import type { TransactionStatus } from "@/generated/prisma/enums";

const STATUS_LABELS: Record<TransactionStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  REIMBURSED: "Reimbursed",
  REJECTED: "Rejected",
  NOT_APPLICABLE: "N/A",
};

const STATUS_VARIANT: Record<
  TransactionStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  DRAFT: "outline",
  SUBMITTED: "secondary",
  APPROVED: "secondary",
  REIMBURSED: "default",
  REJECTED: "destructive",
  NOT_APPLICABLE: "outline",
};

export function TransactionStatusBadge({ status }: { status: TransactionStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABELS[status]}</Badge>;
}
