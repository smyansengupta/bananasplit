"use client";

import {
  ArrowUp,
  CalendarDays,
  Check,
  Flag,
  LayoutDashboard,
  ListTodo,
  Plus,
  Users,
  Wallet,
} from "@/components/icons";

import { Badge } from "@/components/ui/badge";
import { BlockCard } from "@/components/ui/block-card";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusDot, TagChip } from "@/components/ui/chip";
import { Gauge, TickMeter } from "@/components/ui/meters";
import { Stat, StatStrip } from "@/components/ui/stat";
import { accentScaleStyle, type AccentScale } from "@/lib/theme/accent";
import { tokenStyle } from "@/lib/theme/css";
import type { TokenMap } from "@/lib/theme/derive";
import { orgInitials } from "@/lib/theme/logo";
import { styleDeclarations, TEXT_SIZE_ZOOM, type ThemeStyle } from "@/lib/theme/style";
import type { ColorMode } from "@/lib/theme/types";
import { cn } from "@/lib/utils";

const NAV = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Tasks", icon: ListTodo },
  { label: "Calendar", icon: CalendarDays },
  { label: "People", icon: Users },
  { label: "Finance", icon: Wallet },
] as const;

/**
 * A live preview of a palette as a mini Overview, built from the real
 * components (block cards, the stat strip, a surface card with task rows,
 * chips, meters and buttons), so admins see their colours where members
 * will. It sits in a scoped wrapper that sets every design token as a
 * custom property on itself (so everything inside reads the draft theme,
 * not the org's current one); nothing inside is portaled (a Radix portal
 * would escape the wrapper and show the live theme instead). The `dark`
 * class on the wrapper turns on the `dark:` variants inside it. The same
 * derive() output is what the save stores and the layout renders, so the
 * preview equals the saved result. The accent scale and Look and feel
 * (corners, fonts; text size as a zoom, since rem cannot be scoped) are set
 * the same way. The whole thing is inert: nothing in it is a real control.
 */
export function ThemePreview({
  tokens,
  accents,
  style,
  mode,
  orgName,
}: {
  tokens: TokenMap;
  accents: AccentScale;
  style: ThemeStyle;
  mode: ColorMode;
  orgName: string;
}) {
  return (
    <figure className="min-w-0 space-y-2">
      <figcaption className="text-muted-foreground text-[13px] font-medium">
        {mode === "light" ? "Light" : "Dark"}
      </figcaption>
      <div
        data-theme-preview={mode}
        className={cn(
          "bg-background text-foreground ring-foreground/8 rounded-card relative isolate overflow-hidden text-sm ring-1",
          mode === "dark" && "dark",
        )}
        style={{
          ...tokenStyle(tokens),
          ...accentScaleStyle(accents),
          ...styleDeclarations(style),
          colorScheme: mode,
          zoom: TEXT_SIZE_ZOOM[style.textSize],
        }}
        inert
      >
        {/* The glow as light behind the top of the page, as in the app. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-24 -z-10 h-64 bg-[radial-gradient(60%_70%_at_50%_0%,color-mix(in_oklab,var(--glow)_calc(var(--glow-strength,20%)*0.9),transparent),transparent_75%)]"
        />
        <div className="@container grid grid-cols-[8.25rem_minmax(0,1fr)]" style={{ zoom: 0.8 }}>
          <aside className="bg-sidebar text-sidebar-foreground flex flex-col gap-1 p-3">
            <div className="mb-3 flex items-center gap-2 px-1">
              <span className="bg-primary text-primary-foreground rounded-field grid size-7 shrink-0 place-items-center text-[11px] font-semibold">
                {orgInitials(orgName)}
              </span>
              <span className="truncate text-[13px] font-semibold">{orgName}</span>
            </div>
            {NAV.map(({ label, icon: Icon }, i) => (
              <span
                key={label}
                className={cn(
                  "flex h-9 items-center gap-2.5 rounded-full px-3 text-[13px] font-medium",
                  i === 0
                    ? "bg-brand-accent text-brand-accent-foreground glow-halo font-semibold"
                    : "text-sidebar-foreground/80",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </span>
            ))}
          </aside>

          <div className="min-w-0 space-y-5 p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="page-title text-[30px]">Good afternoon</p>
                <p className="text-muted-foreground mt-1.5 text-[13px]">3 things need you today</p>
              </div>
              <span className={buttonVariants({ variant: "create", size: "sm" })}>
                <Plus aria-hidden="true" />
                New task
              </span>
            </div>

            <StatStrip className="sm:gap-x-10">
              <Stat
                icon={ListTodo}
                value="31"
                label="Open tasks"
                chip={<Badge variant="destructive">2 due today</Badge>}
              />
              <Stat
                icon={Users}
                value="42"
                label="At the last meeting"
                chip={
                  <Badge variant="success">
                    <ArrowUp aria-hidden="true" />8
                  </Badge>
                }
              />
              <Stat icon={CalendarDays} value="4" label="Events this week" />
            </StatStrip>

            <div className="grid gap-4 @3xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] @3xl:items-start">
              <div className="grid grid-cols-2 gap-3">
                <BlockCard
                  tone="alert"
                  kicker="Due today"
                  title="Send the GBM agenda"
                  figure="2 of 3"
                  figureLabel="subtasks done"
                  className="min-h-0 p-4 [&_h3]:text-[19px]"
                />
                <BlockCard
                  tone="quiet"
                  kicker="Tomorrow · 7:00 PM"
                  title="Officer meeting"
                  subtitle="Engineering Hall 112"
                  figure="8"
                  figureLabel="going"
                  className="min-h-0 p-4 [&_h3]:text-[19px]"
                />
                <BlockCard
                  tone="answer"
                  kicker="Your answer"
                  title="Pick a weekend for the retreat"
                  figure="3"
                  figureLabel="options"
                  className="min-h-0 p-4 [&_h3]:text-[19px]"
                />
                <BlockCard tone="goal" kicker="RSVPs · Sat, Oct 24" className="min-h-0 p-4">
                  <div className="mt-2 flex items-center gap-3">
                    <Gauge value={53} size={84} className="[&_b]:text-[20px]" />
                    <div className="min-w-0">
                      <p className="display-title text-[17px]">Fall Showcase</p>
                      <p className="mt-1 text-xs text-(--meta)">64 of 120 seats</p>
                    </div>
                  </div>
                </BlockCard>
              </div>

              <Card size="sm">
                <CardHeader className="flex items-center gap-2">
                  <CardTitle>My tasks</CardTitle>
                  <Badge variant="secondary">6</Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  <ul className="divide-border/70 divide-y">
                    <li className="flex items-center gap-3 py-2">
                      <span className="ring-input size-[18px] shrink-0 rounded-full ring-[1.5px] ring-inset" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">Confirm the venue</span>
                        <span className="mt-1 flex items-center gap-2">
                          <TagChip color="var(--tag-forest)">Fall Showcase</TagChip>
                          <span className="text-tint-danger-foreground text-xs font-semibold">
                            Today
                          </span>
                        </span>
                      </span>
                      <Badge variant="destructive">
                        <Flag aria-hidden="true" />
                        Urgent
                      </Badge>
                    </li>
                    <li className="flex items-center gap-3 py-2">
                      <span className="bg-block-goal text-block-goal-foreground grid size-[18px] shrink-0 place-items-center rounded-full">
                        <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="text-muted-foreground block truncate line-through">
                          Book Engineering Hall 112
                        </span>
                        <span className="mt-1 flex items-center gap-2">
                          <TagChip color="var(--tag-rust)">Club operations</TagChip>
                        </span>
                      </span>
                      <Badge variant="accent">High</Badge>
                    </li>
                  </ul>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={buttonVariants({ size: "sm" })}>Save</span>
                    <span className={buttonVariants({ variant: "outline", size: "sm" })}>
                      Cancel
                    </span>
                    <span className={buttonVariants({ variant: "destructive", size: "sm" })}>
                      Delete task
                    </span>
                    <StatusDot color="var(--success)" className="ml-auto">
                      Synced
                    </StatusDot>
                  </div>
                  <div className="flex items-center gap-3">
                    <TickMeter
                      total={20}
                      filled={12}
                      height={14}
                      label="12 of 20"
                      color="var(--chart-1)"
                      className="flex-1"
                    />
                    <span className="flex gap-1" aria-hidden="true">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <span
                          key={n}
                          className="size-2.5 rounded-full"
                          style={{ background: `var(--chart-${n})` }}
                        />
                      ))}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}
