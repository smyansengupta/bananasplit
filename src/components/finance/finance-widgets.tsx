"use client";

import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  FileSpreadsheet,
  ListChecks,
  PiggyBank,
  ReceiptText,
  Target,
  type IconComponent,
} from "@/components/icons";
import Link from "next/link";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/empty-state";
import { Donut, LegendSwatch, seriesColor } from "@/components/reports/charts/chart-kit";
import { TrendChart } from "@/components/reports/charts/trend-chart";
import { Button } from "@/components/ui/button";
import { BlockCard } from "@/components/ui/block-card";
import { Gauge, MixBar, TickMeter } from "@/components/ui/meters";
import { IconChip } from "@/components/ui/stat";
import type { DashboardData, DashboardTransaction } from "@/app/app/[orgSlug]/finance/queries";
import { formatCents, formatDollars } from "@/lib/finance/money";
import { SETUP_STEPS, stepDone, type FinanceSetupState } from "@/lib/finance/setup";
import type { WidgetTypeId } from "@/lib/finance/widgets";
import { cn } from "@/lib/utils";

import { tickUnitCents } from "./budget-ticks";
import { BurnChart } from "./burn-chart";
import { RunwaySection } from "./runway-section";
import { TransactionStatusBadge } from "./transaction-status-badge";

/**
 * The finance widgets' bodies (the board adds the frame, title and edit
 * controls). Every figure comes from DashboardData: the active period's
 * ledger, the same numbers as the budget and transactions pages. Charts are
 * the chart kit's (src/components/reports/charts), coloured only from the
 * theme's chart slots; a category keeps its slot (its place in the budget)
 * in the donut and on its budget line alike.
 */

const KIND_LABEL: Record<string, string> = {
  EXPENSE: "Expenses",
  SPONSORSHIP: "Sponsorships",
  ALLOCATION: "Allocations",
  OTHER_INCOME: "Other income",
  ADJUSTMENT: "Adjustments",
};

const INCOME_LABEL: Record<string, string> = {
  SPONSORSHIP: "Sponsors",
  ALLOCATION: "School funding",
  OTHER_INCOME: "Dues, sales and gifts",
  ADJUSTMENT: "Starting balance and adjustments",
  EXPENSE: "Refunds",
};

const STATUS_LABEL: Record<string, string> = { SUBMITTED: "To approve", APPROVED: "To pay back" };

/** Money outside tables: whole dollars ("$1,830"); tables keep the cents. */
const money = (cents: number) => formatDollars(cents);

/** Axis money: $0, $500, $1.5K, $12K. */
const axisMoney = (cents: number) => {
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1000) {
    const k = dollars / 1000;
    return `${dollars < 0 ? "-" : ""}$${Math.abs(k).toFixed(Math.abs(k) % 1 ? 1 : 0)}K`;
  }
  return `${dollars < 0 ? "-" : ""}$${Math.abs(Math.round(dollars))}`;
};

const shortDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function Big({ value, sub, tone }: { value: ReactNode; sub?: ReactNode; tone?: "good" | "bad" }) {
  return (
    <div className="min-w-0 space-y-2">
      <p
        className={cn(
          "numeral text-[30px] break-all",
          tone === "good" && "text-success",
          tone === "bad" && "text-destructive",
        )}
      >
        {value}
      </p>
      {sub && <p className="text-muted-foreground text-[13px]">{sub}</p>}
    </div>
  );
}

function ChartEmpty({ text, icon }: { text: string; icon?: IconComponent }) {
  return (
    <div className="text-muted-foreground flex min-h-28 flex-col items-center justify-center gap-2.5 py-6 text-center text-sm">
      {icon && <IconChip icon={icon} className="text-muted-foreground" />}
      {text}
    </div>
  );
}

const rowClass =
  "hover:bg-muted/60 focus-glow rounded-field -mx-2.5 flex items-center gap-3 px-2.5 py-2.5 transition-colors outline-none";

function TxList({ rows, orgSlug }: { rows: DashboardTransaction[]; orgSlug: string }) {
  if (rows.length === 0)
    return <ChartEmpty text="No transactions yet this period" icon={ReceiptText} />;
  return (
    <ul className="divide-border/70 divide-y">
      {rows.map((t) => {
        const inbound = t.direction === "IN";
        const Icon = inbound ? ArrowDownLeft : ArrowUpRight;
        return (
          <li key={t.id}>
            <Link href={`/app/${orgSlug}/finance/transactions`} className={rowClass}>
              <span
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-full",
                  inbound ? "bg-tint-success text-tint-success-foreground" : "bg-muted",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{t.description}</span>
                <span className="text-muted-foreground block text-xs">
                  {shortDate.format(new Date(t.occurredAt))}
                  {t.categoryName ? ` · ${t.categoryName}` : ""}
                </span>
              </span>
              <span className={cn("text-sm font-semibold tabular-nums", inbound && "text-success")}>
                {inbound ? "+" : "−"}
                {formatCents(t.amountCents)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Shortcut({
  href,
  icon,
  label,
  detail,
}: {
  href: string;
  icon: IconComponent;
  label: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      className="bg-muted/50 hover:bg-muted focus-glow rounded-tile group/sc flex items-center gap-3 p-3 transition-[background-color,transform] duration-200 ease-(--ease-ink) outline-none hover:-translate-y-0.5 motion-reduce:transform-none"
    >
      <IconChip icon={icon} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{label}</span>
        <span className="text-muted-foreground block truncate text-xs">{detail}</span>
      </span>
      <ArrowRight
        className="text-muted-foreground size-4 shrink-0 transition-transform group-hover/sc:translate-x-0.5"
        aria-hidden="true"
      />
    </Link>
  );
}

/**
 * Budget vs. actual: a Progress block with the budget gauge (spent of
 * everything allocated), then one tick meter per budget line, drawn to
 * scale: every tick is the same amount on every line.
 */
function BudgetWidget({ data, base }: { data: DashboardData; base: string }) {
  if (data.categories.length === 0) {
    return (
      <EmptyState
        size="compact"
        title="No budget categories yet"
        description="Give each category an amount to see spending against it."
        action={
          <Button asChild size="sm" variant="outline">
            <Link href={`${base}/budget`}>Set up the budget</Link>
          </Button>
        }
      />
    );
  }
  const spent = data.categories.reduce((sum, c) => sum + c.spentCents, 0);
  const total = data.totalAllocatedCents;
  const left = total - spent;
  const pct = total > 0 ? (spent / total) * 100 : 0;
  const maxAllocated = Math.max(...data.categories.map((c) => c.allocatedCents), 1);
  const unit = tickUnitCents(maxAllocated);
  const maxTicks = Math.ceil(maxAllocated / unit);

  return (
    <div className="@container">
      <div className="grid gap-5 @md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] @md:items-start">
        <BlockCard
          tone="goal"
          kicker={data.period ? `Budget · ${data.period.label}` : "Budget"}
          className="min-h-0 p-4.5"
          action={
            <Link
              href={`${base}/budget`}
              aria-label="Open the budget"
              className="focus-glow grid size-8 place-items-center rounded-full ring-1 ring-current/30 transition-[background-color,transform] ring-inset hover:bg-current/10 active:scale-[0.94]"
            >
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Link>
          }
        >
          <div className="mt-3 flex items-center gap-3.5 @md:flex-col @md:items-start">
            <Gauge value={pct} caption={spent > total ? "over" : "spent"} size={112} />
            <div className="min-w-0">
              <p className="display-title text-[19px]">
                {money(spent)} of {money(total)}
              </p>
              <p className="mt-1 text-[13px] text-(--meta)">
                {left >= 0 ? `${money(left)} left to spend` : `${money(-left)} over budget`}
              </p>
            </div>
          </div>
        </BlockCard>
        <div className="min-w-0 space-y-3.5">
          {data.categories.map((c, i) => {
            const over = c.spentCents > c.allocatedCents;
            const ticks = Math.max(1, Math.ceil(c.allocatedCents / unit));
            return (
              <div key={c.id} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{c.name}</span>
                  <span
                    className={cn(
                      "shrink-0 text-[13px] tabular-nums",
                      over ? "text-destructive font-semibold" : "text-muted-foreground",
                    )}
                  >
                    {money(c.spentCents)} of {money(c.allocatedCents)}
                  </span>
                </div>
                {c.allocatedCents > 0 ? (
                  <div style={{ width: `${Math.max(8, (ticks / maxTicks) * 100)}%` }}>
                    <TickMeter
                      total={ticks}
                      filled={over ? ticks : c.spentCents / unit}
                      height={16}
                      color={over ? "var(--destructive)" : seriesColor(i)}
                      label={`${c.name}: ${money(c.spentCents)} of ${money(c.allocatedCents)}${over ? ", over budget" : ""}`}
                    />
                  </div>
                ) : (
                  <p className="text-muted-foreground text-xs">Nothing allocated</p>
                )}
              </div>
            );
          })}
          <p className="text-muted-foreground pt-0.5 text-xs">One tick per {money(unit)}</p>
        </div>
      </div>
    </div>
  );
}

export function WidgetBody({
  type,
  data,
  orgSlug,
  setup,
}: {
  type: WidgetTypeId;
  data: DashboardData;
  orgSlug: string;
  /** Where finance setup stands (the setup widget). */
  setup?: FinanceSetupState;
}) {
  const base = `/app/${orgSlug}/finance`;
  // Null until the club sets up a budget: every widget still renders, empty.
  const period = data.period;
  // A category's slot is its place in the budget, on every chart.
  const slotOf = new Map(data.categories.map((c, i) => [c.id, seriesColor(i)]));
  switch (type) {
    case "balance":
      return (
        <Big
          value={money(data.balanceCents)}
          sub={period?.label ?? "No budget period yet"}
          tone={data.balanceCents < 0 ? "bad" : undefined}
        />
      );
    case "in-out":
      return (
        // Side by side when the widget is wide enough, stacked when not.
        <div className="flex flex-wrap gap-x-7 gap-y-4">
          <Big value={money(data.inTotalCents)} sub="In" tone="good" />
          <Big value={money(data.outTotalCents)} sub="Out" />
        </div>
      );
    case "allocated": {
      const spent = data.categories.reduce((sum, c) => sum + c.spentCents, 0);
      return (
        <Big
          value={money(data.totalAllocatedCents)}
          sub={`${money(spent)} spent of it`}
        />
      );
    }
    case "owed":
      return (
        <Big
          value={money(data.outstandingReimbursementsCents)}
          sub={
            <Link
              href={`/app/${orgSlug}/finance/transactions?kind=EXPENSE`}
              className="hover:text-foreground underline-offset-4 hover:underline"
            >
              Expenses not yet paid back
            </Link>
          }
        />
      );
    case "pending":
      return (
        <Big
          value={data.pendingApproval.count}
          sub={
            data.pendingApproval.count > 0 ? (
              <Link
                href={`/app/${orgSlug}/finance/transactions?status=SUBMITTED`}
                className="hover:text-foreground underline-offset-4 hover:underline"
              >
                {money(data.pendingApproval.cents)} to review
              </Link>
            ) : (
              "Nothing to review"
            )
          }
        />
      );
    case "burn":
      return <BurnChart data={data.burnByMonth} />;
    case "trend": {
      if (data.balanceTrend.length === 0)
        return <ChartEmpty text="No transactions yet this period" icon={ReceiptText} />;
      const first = data.balanceTrend[0].balanceCents;
      return (
        <TrendChart
          label={`Balance over the period, ${data.balanceTrend.length} days with activity`}
          seriesLabel="Balance"
          format={formatCents}
          formatAxis={axisMoney}
          reference={{ value: first, label: `Started at ${money(first)}`, short: "Start" }}
          points={data.balanceTrend.map((p) => ({
            key: p.date,
            tick: shortDate.format(new Date(p.date)),
            heading: shortDate.format(new Date(p.date)),
            value: p.balanceCents,
          }))}
        />
      );
    }
    case "by-category": {
      const slices = data.categories.filter((c) => c.spentCents > 0);
      if (slices.length === 0)
        return <ChartEmpty text="Nothing spent in a category yet" icon={PiggyBank} />;
      const total = slices.reduce((sum, c) => sum + c.spentCents, 0);
      return (
        <Donut
          label={`Spending by category: ${slices.map((c) => `${c.name} ${money(c.spentCents)}`).join(", ")}`}
          center={axisMoney(total)}
          centerLabel="spent"
          parts={slices.map((c) => ({
            label: c.name,
            value: c.spentCents,
            color: slotOf.get(c.id),
            display: (
              <>
                {money(c.spentCents)}
                <span className="text-muted-foreground ml-2 inline-block w-9 text-right font-normal">
                  {Math.round((c.spentCents / total) * 100)}%
                </span>
              </>
            ),
          }))}
        />
      );
    }
    case "by-kind": {
      const rows = data.spendByKind.map((k, i) => ({
        label: KIND_LABEL[k.kind] ?? k.kind,
        cents: k.cents,
        color: seriesColor(i),
      }));
      if (rows.length === 0)
        return <ChartEmpty text="Nothing spent yet this period" icon={ReceiptText} />;
      const total = rows.reduce((sum, r) => sum + r.cents, 0);
      return (
        <div className="space-y-4">
          <p className="flex items-baseline gap-2">
            <span className="numeral text-[30px]">{money(total)}</span>
            <span className="text-muted-foreground text-[13px]">out this period</span>
          </p>
          <MixBar
            height={36}
            legend={false}
            label={rows.map((r) => `${r.label} ${money(r.cents)}`).join(", ")}
            segments={rows.map((r) => ({ label: r.label, value: r.cents, color: r.color }))}
          />
          <ul className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
            {rows.map((r) => (
              <li key={r.label} className="flex min-w-0 items-center gap-2">
                <LegendSwatch shape="rect" color={r.color} />
                <span className="min-w-0 flex-1 truncate">{r.label}</span>
                <b className="font-semibold tabular-nums">{money(r.cents)}</b>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case "budget":
      return <BudgetWidget data={data} base={base} />;
    case "runway":
      return data.runway && period ? (
        <RunwaySection
          runway={data.runway}
          period={period}
          expectedIncomeCents={data.sponsorshipCommittedCents}
          hideHeading
        />
      ) : (
        <ChartEmpty text="Not enough history to project yet" icon={Target} />
      );
    case "sponsorships": {
      const received = data.sponsorshipReceivedCents;
      const committed = data.sponsorshipCommittedCents;
      return (
        <div className="space-y-3.5 text-sm">
          {received + committed > 0 && (
            <MixBar
              height={14}
              legend={false}
              label={`${money(received)} received, ${money(committed)} committed and still to come`}
              segments={[
                { label: "Received", value: received, color: "var(--chart-1)" },
                { label: "Committed", value: committed, hatch: true },
              ]}
            />
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2">
              <LegendSwatch shape="rect" color="var(--chart-1)" />
              Received
            </span>
            <span className="font-semibold tabular-nums">{formatCents(received)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2">
              <LegendSwatch shape="hatch" color="var(--chart-1)" />
              Committed
            </span>
            <span className="font-semibold tabular-nums">{formatCents(committed)}</span>
          </div>
          {data.sponsorshipCreditsCents > 0 && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground inline-flex items-center gap-2">
                <LegendSwatch shape="rect" color="var(--muted-foreground)" />
                In credits
              </span>
              <span className="font-semibold tabular-nums">
                {formatCents(data.sponsorshipCreditsCents)}
              </span>
            </div>
          )}
          <p className="text-muted-foreground text-xs">
            Pledged money never counts toward the balance
            {data.sponsorshipCreditsCents > 0 ? ", and credits never do" : ""}.
          </p>
        </div>
      );
    }
    case "recent":
      return <TxList rows={data.recent} orgSlug={orgSlug} />;
    case "top-expenses":
      return <TxList rows={data.topExpenses} orgSlug={orgSlug} />;
    case "left-to-spend": {
      const spent = data.categories.reduce((sum, c) => sum + c.spentCents, 0);
      const left = data.totalAllocatedCents - spent;
      if (data.totalAllocatedCents === 0) {
        return (
          <Big
            value="—"
            sub={
              <Link
                href={`${base}/budget`}
                className="hover:text-foreground underline-offset-4 hover:underline"
              >
                Set a budget to see this
              </Link>
            }
          />
        );
      }
      return (
        <Big
          value={formatCents(left)}
          sub={`of ${money(data.totalAllocatedCents)} budgeted`}
          tone={left < 0 ? "bad" : undefined}
        />
      );
    }
    case "income-sources": {
      const rows = data.incomeByKind.map((k) => ({
        label: INCOME_LABEL[k.kind] ?? k.kind,
        cents: k.cents,
      }));
      if (rows.length === 0)
        return <ChartEmpty text="No money in yet this period" icon={ArrowDownLeft} />;
      const total = rows.reduce((sum, r) => sum + r.cents, 0);
      return (
        <Donut
          label={`Money in by source: ${rows.map((r) => `${r.label} ${money(r.cents)}`).join(", ")}`}
          center={axisMoney(total)}
          centerLabel="in"
          parts={rows.map((r) => ({
            label: r.label,
            value: r.cents,
            display: (
              <>
                {money(r.cents)}
                <span className="text-muted-foreground ml-2 inline-block w-9 text-right font-normal">
                  {Math.round((r.cents / total) * 100)}%
                </span>
              </>
            ),
          }))}
        />
      );
    }
    case "reimbursements":
      if (data.reimbursementQueue.length === 0) {
        return <ChartEmpty text="Nobody is waiting to be paid back" icon={Check} />;
      }
      return (
        <ul className="divide-border/70 divide-y">
          {data.reimbursementQueue.map((t) => (
            <li key={t.id}>
              <Link href={`${base}/transactions?status=${t.status}`} className={rowClass}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{t.description}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {t.submitter} · {shortDate.format(new Date(t.occurredAt))}
                  </span>
                </span>
                <TransactionStatusBadge status={t.status} label={STATUS_LABEL[t.status]} />
                <span className="w-20 text-right text-sm font-semibold tabular-nums">
                  {formatCents(t.amountCents)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      );
    case "shortcuts":
      return (
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Shortcut
            href={`${base}/import`}
            icon={FileSpreadsheet}
            label="Import a spreadsheet"
            detail="Bank exports, PDFs, an old sheet"
          />
          <Shortcut
            href={`${base}/budget`}
            icon={PiggyBank}
            label="Budget"
            detail="What each category may spend"
          />
          <Shortcut
            href={`${base}/transactions?status=SUBMITTED`}
            icon={ReceiptText}
            label="Requests to review"
            detail={
              data.pendingApproval.count
                ? `${data.pendingApproval.count} waiting`
                : "Nothing waiting"
            }
          />
          <Shortcut
            href={`${base}/setup`}
            icon={ListChecks}
            label="Setup guide"
            detail="Budget year, balance, treasurers"
          />
        </div>
      );
    case "setup": {
      if (!setup)
        return <ChartEmpty text="Open the setup guide to see what's left" icon={ListChecks} />;
      return (
        <ul className="space-y-0.5">
          {SETUP_STEPS.map((step) => {
            const ok = stepDone(setup, step.id);
            return (
              <li key={step.id}>
                <Link href={`${base}/setup`} className={cn(rowClass, "py-2")}>
                  <span
                    className={cn(
                      "grid size-[22px] shrink-0 place-items-center rounded-full",
                      ok
                        ? "bg-block-goal text-block-goal-foreground"
                        : "ring-input ring-[1.5px] ring-inset",
                    )}
                  >
                    {ok && <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />}
                  </span>
                  <span
                    className={cn("min-w-0 flex-1 truncate text-sm", ok && "text-muted-foreground")}
                  >
                    {step.title}
                    {ok && <span className="sr-only"> (done)</span>}
                  </span>
                  {!ok && !step.core && (
                    <span className="text-muted-foreground text-xs">Optional</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      );
    }
  }
}
