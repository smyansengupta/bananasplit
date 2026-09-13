import { NotebookText } from "lucide-react";

import { EmptyState } from "@/components/empty-state";

export default function NotesPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Notes</h1>
      <EmptyState
        icon={NotebookText}
        title="Notes arrive in Phase 3"
        description="Rich-text notes with markdown support and event linking will live here."
      />
    </div>
  );
}
