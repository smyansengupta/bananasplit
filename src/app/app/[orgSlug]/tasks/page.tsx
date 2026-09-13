import { CheckSquare } from "lucide-react";

import { EmptyState } from "@/components/empty-state";

export default function TasksPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
      <EmptyState
        icon={CheckSquare}
        title="Task management arrives in Phase 2"
        description="Kanban, table, and calendar views for tasks will live here."
      />
    </div>
  );
}
