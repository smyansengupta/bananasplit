"use client";

import { CalendarDays, CheckCircle2, LayoutDashboard, ListTodo, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { tokenStyle } from "@/lib/theme/css";
import type { TokenMap } from "@/lib/theme/derive";
import { orgInitials } from "@/lib/theme/logo";
import type { ColorMode } from "@/lib/theme/types";
import { cn } from "@/lib/utils";

const BAR_HEIGHTS = ["h-10", "h-14", "h-8", "h-12", "h-6"] as const;
const CHART_CLASSES = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
] as const;

/**
 * A live preview of a palette: a scoped wrapper that sets every design
 * token as a custom property on itself (so everything inside reads the
 * draft theme, not the org's current one), around NON-portaled mock
 * components (a Radix portal would escape the wrapper and show the live
 * theme instead). The `dark` class on the wrapper turns on the `dark:`
 * variants inside it. The same derive() output is what the save stores and
 * the layout renders, so the preview equals the saved result.
 */
export function ThemePreview({
  tokens,
  mode,
  orgName,
}: {
  tokens: TokenMap;
  mode: ColorMode;
  orgName: string;
}) {
  return (
    <figure className="space-y-2">
      <figcaption className="text-muted-foreground text-xs font-medium">
        {mode === "light" ? "Light" : "Dark"}
      </figcaption>
      <div
        data-theme-preview={mode}
        className={cn(
          "bg-background text-foreground overflow-hidden rounded-xl border text-sm",
          mode === "dark" && "dark",
        )}
        style={{ ...tokenStyle(tokens), colorScheme: mode }}
        // Mock controls: nothing here is a real control, so keep it out of
        // the tab order and the accessibility tree's interactive roles.
        inert
      >
        <div className="grid grid-cols-[8.5rem_1fr]">
          <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border flex flex-col gap-1 border-r p-2.5">
            <div className="mb-2 flex items-center gap-2">
              <span className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md text-[10px] font-semibold">
                {orgInitials(orgName)}
              </span>
              <span className="truncate text-xs font-semibold">{orgName}</span>
            </div>
            <span className="bg-sidebar-accent text-sidebar-accent-foreground flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium">
              <LayoutDashboard className="size-3.5" aria-hidden="true" />
              Overview
            </span>
            <span className="text-sidebar-foreground/80 flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium">
              <ListTodo className="size-3.5" aria-hidden="true" />
              Tasks
            </span>
            <span className="text-sidebar-foreground/80 flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium">
              <CalendarDays className="size-3.5" aria-hidden="true" />
              Calendar
            </span>
          </aside>

          <div className="min-w-0 space-y-3 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-auto text-sm font-semibold">Weekly meeting</span>
              <Button size="sm" variant="outline">
                Edit
              </Button>
              <Button size="sm">Publish</Button>
            </div>

            <div className="bg-card text-card-foreground space-y-2 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <span className="font-medium">Kickoff meeting</span>
                <Badge>Public</Badge>
                <Badge variant="secondary">Workshop</Badge>
              </div>
              <p className="text-muted-foreground text-xs">
                Thursday, 6 pm in the student center. 42 members checked in last week.
              </p>
              <p className="text-xs">
                Read the{" "}
                <span className="text-primary underline underline-offset-4">run of show</span>{" "}
                before you set up.
              </p>
              <div className="flex flex-wrap gap-3 text-xs">
                <span className="text-success inline-flex items-center gap-1">
                  <CheckCircle2 className="size-3.5" aria-hidden="true" />
                  Room booked
                </span>
                <span className="text-warning inline-flex items-center gap-1">
                  <TriangleAlert className="size-3.5" aria-hidden="true" />
                  Food pending
                </span>
                <span className="text-destructive">1 overdue task</span>
              </div>
            </div>

            <div className="grid grid-cols-[1fr_auto] items-end gap-3">
              <div className="bg-popover text-popover-foreground space-y-2 rounded-lg border p-3 shadow-md">
                <p className="text-xs font-medium">Rename session</p>
                <Input
                  defaultValue="Intro to agents"
                  className="h-7 text-xs"
                  readOnly
                  tabIndex={-1}
                />
                <div className="flex justify-end gap-2">
                  <Button size="xs" variant="ghost">
                    Cancel
                  </Button>
                  <Button size="xs" variant="destructive">
                    Delete
                  </Button>
                </div>
              </div>
              <div
                className="bg-card flex items-end gap-1 rounded-lg border p-2"
                aria-hidden="true"
              >
                {CHART_CLASSES.map((chart, i) => (
                  <span key={chart} className={cn("w-3 rounded-sm", chart, BAR_HEIGHTS[i])} />
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="bg-accent text-accent-foreground rounded-md px-2 py-1">
                Highlighted item
              </span>
              <span className="bg-brand-accent text-brand-accent-foreground rounded-md px-2 py-1 font-medium">
                Accent fill
              </span>
              <span className="bg-muted text-muted-foreground rounded-md px-2 py-1">
                Muted panel
              </span>
              <span className="ring-ring/50 border-ring rounded-md border px-2 py-1 ring-3">
                Focus
              </span>
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}
