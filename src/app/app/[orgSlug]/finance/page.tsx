import { Wallet } from "lucide-react";

import { EmptyState } from "@/components/empty-state";

export default function FinancePage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
      <EmptyState
        icon={Wallet}
        title="Finance tracking arrives in Phase 5"
        description="Owners and treasurers will see the full ledger and budgets here; everyone else sees their own reimbursements."
      />
    </div>
  );
}
