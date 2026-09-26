import { CircleCheck, CircleMinus, CircleX, TriangleAlert, type LucideIcon } from "lucide-react";

import { formatFinanceDate, type Runway, type RunwayStatus } from "@/lib/finance/stats";
import { cn } from "@/lib/utils";

const TONE: Record<RunwayStatus, { icon: LucideIcon; className: string }> = {
  out: { icon: CircleX, className: "text-destructive" },
  short: { icon: TriangleAlert, className: "text-warning" },
  lasts: { icon: CircleCheck, className: "text-success" },
  idle: { icon: CircleMinus, className: "text-muted-foreground" },
};

function summary(runway: Runway, periodEndsOn: Date): string {
  switch (runway.status) {
    case "out":
      return "Out of funds";
    case "short":
      return runway.runOutDate
        ? `Runs out ${formatFinanceDate(runway.runOutDate)}`
        : "Runs out this period";
    case "lasts":
      return `Lasts past ${formatFinanceDate(periodEndsOn)}`;
    case "idle":
      return "No recent spending";
  }
}

/** Where the money stands against the period's end: always words beside the icon. */
export function RunwayStatusLabel({
  runway,
  periodEndsOn,
  className,
}: {
  runway: Runway;
  periodEndsOn: Date;
  className?: string;
}) {
  const { icon: Icon, className: tone } = TONE[runway.status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm font-medium", tone, className)}>
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {summary(runway, periodEndsOn)}
    </span>
  );
}
