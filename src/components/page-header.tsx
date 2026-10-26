import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The top of every app page: the title in the display face on the left and
 * the page's actions on the right, ON THE TITLE'S OWN ROW — the create
 * button lines up with the title, never with the summary line under it.
 * The summary (e.g. "31 open across 5 projects") sits below that row, and
 * the page's tabs, if it has any, below that. One create (variant="create")
 * action at most; everything else outline or ghost.
 *
 * On a phone the create action always sits at the top right, beside the
 * title, on every page alike, and the other actions go under it. (It is
 * found by its data-variant, so pages pass actions as before.) The summary
 * line is left out there: the page itself says it.
 */
/**
 * On a phone every page's add button (and the halves of a split one) is the
 * small size, Files' New, so the corner looks the same on every page.
 */
export const PHONE_SMALL_CREATE = cn(
  "max-md:[&_[data-variant=create]]:h-8 max-md:[&_[data-variant=create]]:gap-1.5 max-md:[&_[data-variant=create]]:text-[0.8125rem]",
  "max-md:[&_[data-variant=create]:not([aria-haspopup])]:px-3.5",
);

export function PageHeader({
  title,
  description,
  actions,
  tabs,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** A <PageTabs> strip under the title row. */
  tabs?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("space-y-4", className)}>
      <div className="min-w-0 space-y-2">
        {/*
          The title's own row. The actions share it, so a create button is
          level with the title whatever the summary line underneath says —
          and whether or not the page has one at all.
        */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 max-md:gap-x-3">
          <h1 className="page-title min-w-0 max-md:order-1 max-md:flex-1">{title}</h1>
          {/* A phone: ends the title row, so other actions never ride up beside the add button. */}
          {actions && (
            <span
              aria-hidden="true"
              className="hidden max-md:order-3 max-md:-mb-3 max-md:block max-md:h-0 max-md:basis-full"
            />
          )}
          {actions && (
            <div
              className={cn(
                "flex flex-wrap items-center gap-2",
                // A phone: the add button (or the group it sits in) moves up
                // beside the title; the other actions go under it.
                "max-md:order-4 max-md:basis-full",
                "max-md:has-[[data-variant=create]]:contents",
                "max-md:[&>*]:order-4 max-md:[&>:has([data-variant=create])]:order-2 max-md:[&>[data-variant=create]]:order-2",
                PHONE_SMALL_CREATE,
              )}
            >
              {actions}
            </div>
          )}
        </div>
        {description && (
          <p className="text-muted-foreground text-[15px] max-md:hidden">{description}</p>
        )}
      </div>
      {tabs}
    </header>
  );
}
