import { CalendarDays } from "lucide-react";

import { EmptyState } from "@/components/empty-state";

export default function CalendarPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
      <EmptyState
        icon={CalendarDays}
        title="Calendar and scheduling arrive in Phase 4"
        description="Events, RSVPs, and availability polls will live here."
      />
    </div>
  );
}
