"use client";

import { HandCoins, ReceiptText } from "@/components/icons";

import { Badge } from "@/components/ui/badge";
import { Stat, StatStrip } from "@/components/ui/stat";

/**
 * My reimbursements' stat strip: what the club owes the member, and how
 * many requests they have (with how many still wait for approval or payment).
 */
export function ReimbursementStats({
  owed,
  requests,
  waiting,
}: {
  /** Formatted money ("$42.50"). */
  owed: string;
  requests: number;
  waiting: number;
}) {
  return (
    <StatStrip>
      <Stat icon={HandCoins} value={owed} label="Money owed to you" />
      <Stat
        icon={ReceiptText}
        value={requests}
        label={requests === 1 ? "Request" : "Requests"}
        chip={waiting > 0 ? <Badge variant="secondary">{waiting} waiting</Badge> : undefined}
      />
    </StatStrip>
  );
}
