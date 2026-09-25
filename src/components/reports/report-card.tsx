import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, TriangleAlert } from "lucide-react";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { asOfLabel } from "./format";

/**
 * The frame of one report: title, a one-line definition, a "View data" deep
 * link into the filtered database view, the body, and when the numbers were
 * computed ("as of", in the org timezone).
 */
export function ReportCard({
  id,
  title,
  description,
  viewHref,
  viewLabel = "View data",
  computedAt,
  tz,
  className,
  children,
}: {
  id: string;
  title: string;
  description: string;
  viewHref?: string | null;
  viewLabel?: string;
  computedAt?: string | null;
  tz: string;
  className?: string;
  children: ReactNode;
}) {
  const headingId = `report-${id}-title`;
  return (
    <Card className={cn("min-w-0 flex-1", className)} aria-labelledby={headingId} role="region">
      <CardHeader>
        <CardTitle id={headingId}>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        {viewHref ? (
          <CardAction>
            <Link
              href={viewHref}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex items-center gap-1 rounded-md text-xs font-medium whitespace-nowrap outline-none focus-visible:ring-3"
            >
              {viewLabel}
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">{children}</CardContent>
      {computedAt ? (
        <p className="text-muted-foreground px-(--card-spacing) text-xs tabular-nums">
          {asOfLabel(computedAt, tz)}
        </p>
      ) : null}
    </Card>
  );
}

/** Shown in place of a report whose query failed; the rest of the page still renders. */
export function ReportError({ id, title, tz }: { id: string; title: string; tz: string }) {
  return (
    <ReportCard id={id} title={title} description="This report could not be loaded." tz={tz}>
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <TriangleAlert className="size-4" aria-hidden="true" />
        Something went wrong while computing it. Try Refresh, or reload the page.
      </p>
    </ReportCard>
  );
}

/** A body for a report with nothing to show in the range. */
export function ReportEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="text-muted-foreground flex min-h-24 flex-1 items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm">
      {children}
    </div>
  );
}
