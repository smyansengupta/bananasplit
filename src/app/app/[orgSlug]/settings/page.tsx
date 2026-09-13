import { Settings } from "lucide-react";

import { EmptyState } from "@/components/empty-state";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <EmptyState
        icon={Settings}
        title="Member management arrives in Phase 1"
        description="Roles, invitations, and org settings will live here."
      />
    </div>
  );
}
