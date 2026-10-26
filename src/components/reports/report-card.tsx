import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, ChartNoAxesColumn, TriangleAlert, type IconComponent } from "@/components/icons";

import { Button } from "@/components/ui/button";
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
 * The frame of one report (a Moonstone surface card): the title and a
 * one-line definition on space, the ↗ circle that opens the rows behind it
 * in the filtered database view, the body, and when the numbers were
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
            <Button asChild variant="outline" size="icon-sm">
              <Link href={viewHref} aria-label={viewLabel} title={viewLabel}>
                <ArrowUpRight aria-hidden="true" />
              </Link>
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-5">{children}</CardContent>
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
      <p className="bg-tint-danger text-tint-danger-foreground rounded-tile flex items-start gap-2 p-3 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        Something went wrong while computing it. Refresh the reports to try again, or reload the
        page.
      </p>
    </ReportCard>
  );
}

/** A body for a report with nothing to show in the range: the section's icon and one sentence. */
export function ReportEmpty({
  children,
  icon: Icon = ChartNoAxesColumn,
}: {
  children: ReactNode;
  icon?: IconComponent;
}) {
  return (
    <div className="bg-muted/40 rounded-tile text-muted-foreground flex min-h-28 flex-1 flex-col items-center justify-center gap-2.5 p-6 text-center text-sm">
      <span className="bg-muted grid size-10 place-items-center rounded-full">
        <Icon className="size-[18px]" aria-hidden="true" />
      </span>
      <p className="max-w-[34ch]">{children}</p>
    </div>
  );
}
