"use client";

import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  FileSpreadsheet,
  HandCoins,
  ListChecks,
  PiggyBank,
  ReceiptText,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import type { DashboardData, DashboardTransaction } from "@/app/app/[orgSlug]/finance/queries";
import { formatCents } from "@/lib/finance/money";
import { SETUP_STEPS, stepDone, type FinanceSetupState } from "@/lib/finance/setup";
import type { WidgetTypeId } from "@/lib/finance/widgets";
import { cn } from "@/lib/utils";

import { BurnChart } from "./burn-chart";
import { RunwaySection } from "./runway-section";

/**
 * The finance widgets' bodies (the board adds the frame, title and edit
 * controls). Every figure comes from DashboardData: the active period's
 * ledger, the same numbers as the budget and transactions pages.
 */

const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

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

const money = (cents: number) => formatCents(cents).replace(/\.00$/, "");

const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function Big({ value, sub, tone }: { value: ReactNode; sub?: ReactNode; tone?: "good" | "bad" }) {
  return (
    <div className="space-y-1">
      <p
        className={cn(
          "text-2xl font-semibold tabular-nums",
          tone === "good" && "text-success",
          tone === "bad" && "text-destructive",
        )}
      >
        {value}
      </p>
      {sub && <p className="text-muted-foreground text-xs">{sub}</p>}
    </div>
  );
}

function ChartEmpty({ icon, text }: { icon?: LucideIcon; text: string }) {
  return <EmptyState size="compact" icon={icon} title={text} className="py-8" />;
}

function TxList({ rows, orgSlug }: { rows: DashboardTransaction[]; orgSlug: string }) {
  if (rows.length === 0) return <ChartEmpty text="No transactions yet this period" />;
  return (
    <ul className="divide-y">
      {rows.map((t) => {
        const inbound = t.direction === "IN";
        const Icon = inbound ? ArrowDownLeft : ArrowUpRight;
        return (
          <li key={t.id}>
            <Link
              href={`/app/${orgSlug}/finance/transactions`}
              className="hover:bg-accent/50 -mx-2 flex items-center gap-3 rounded-md px-2 py-2"
            >
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full",
                  inbound ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
                )}
              >
                <Icon className="size-3.5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{t.description}</span>
                <span className="text-muted-foreground block text-xs">
                  {shortDate.format(new Date(t.occurredAt))}
                  {t.categoryName ? ` · ${t.categoryName}` : ""}
                </span>
              </span>
              <span className={cn("text-sm font-medium tabular-nums", inbound && "text-success")}>
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

function Shortcut({ href, icon: Icon, label, detail }: { href: string; icon: LucideIcon; label: string; detail: string }) {
  return (
    <Link href={href} className="hover:bg-accent/60 flex items-center gap-3 rounded-lg border p-2.5 transition-colors">
      <span className="bg-primary/10 text-primary grid size-8 shrink-0 place-items-center rounded-md">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{label}</span>
        <span className="text-muted-foreground block truncate text-xs">{detail}</span>
      </span>
      <ArrowRight className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
    </Link>
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
  switch (type) {
    case "balance":
      return (
        <Big
          value={formatCents(data.balanceCents)}
          sub={period?.label ?? "No budget period yet"}
          tone={data.balanceCents < 0 ? "bad" : undefined}
        />
      );
    case "in-out":
      return (
        <div className="grid grid-cols-2 gap-3">
          <Big value={money(data.inTotalCents)} sub="In" tone="good" />
          <Big value={money(data.outTotalCents)} sub="Out" />
        </div>
      );
    case "allocated": {
      const spent = data.categories.reduce((sum, c) => sum + c.spentCents, 0);
      return (
        <Big
          value={formatCents(data.totalAllocatedCents)}
          sub={`${formatCents(spent)} spent of it`}
        />
      );
    }
    case "owed":
      return (
        <Big
          value={formatCents(data.outstandingReimbursementsCents)}
          sub={
            <Link href={`/app/${orgSlug}/finance/transactions?kind=EXPENSE`} className="hover:underline">
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
                className="hover:underline"
              >
                {formatCents(data.pendingApproval.cents)} to review
              </Link>
            ) : (
              "Nothing to review"
            )
          }
        />
      );
    case "burn":
      return <BurnChart data={data.burnByMonth} />;
    case "trend":
      if (data.balanceTrend.length === 0) return <ChartEmpty text="No transactions yet this period" />;
      return (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data.balanceTrend} margin={{ left: 0, right: 8, top: 8 }}>
            <defs>
              <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 12 }}
              tickFormatter={(d: string) => shortDate.format(new Date(d))}
              minTickGap={24}
            />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => money(v)} width={70} />
            <Tooltip
              formatter={(value) => formatCents(Number(value ?? 0))}
              labelFormatter={(d) => shortDate.format(new Date(String(d)))}
            />
            <Area
              type="monotone"
              dataKey="balanceCents"
              name="Balance"
              stroke="var(--chart-1)"
              strokeWidth={2}
              fill="url(#trendFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      );
    case "by-category": {
      const slices = data.categories.filter((c) => c.spentCents > 0);
      if (slices.length === 0) return <ChartEmpty text="Nothing spent in a category yet" />;
      const total = slices.reduce((sum, c) => sum + c.spentCents, 0);
      return (
        <div className="flex flex-col items-center gap-4 sm:flex-row">
          <div className="h-44 w-44 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="spentCents"
                  nameKey="name"
                  innerRadius="58%"
                  outerRadius="100%"
                  paddingAngle={2}
                  stroke="none"
                >
                  {slices.map((c, i) => (
                    <Cell key={c.id} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatCents(Number(value ?? 0))} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="w-full min-w-0 space-y-1.5">
            {slices.map((c, i) => (
              <li key={c.id} className="flex items-center gap-2 text-sm">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {Math.round((c.spentCents / total) * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case "by-kind": {
      const rows = data.spendByKind.map((k) => ({ label: KIND_LABEL[k.kind] ?? k.kind, cents: k.cents }));
      if (rows.length === 0) return <ChartEmpty text="Nothing spent yet this period" />;
      return (
        <ResponsiveContainer width="100%" height={Math.max(120, rows.length * 44)}>
          <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(value) => formatCents(Number(value ?? 0))} />
            <Bar dataKey="cents" name="Spent" radius={[0, 4, 4, 0]}>
              {rows.map((r, i) => (
                <Cell key={r.label} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      );
    }
    case "budget":
      if (data.categories.length === 0) {
        return (
          <EmptyState
            size="compact"
            title="No budget categories yet"
            action={
              <Link href={`/app/${orgSlug}/finance/budget`} className="text-primary text-sm hover:underline">
                Set up the budget
              </Link>
            }
          />
        );
      }
      return (
        <div className="space-y-3">
          {data.categories.map((c) => {
            const pct =
              c.allocatedCents > 0 ? Math.min(100, Math.round((c.spentCents / c.allocatedCents) * 100)) : 0;
            const over = c.spentCents > c.allocatedCents;
            return (
              <div key={c.id} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{c.name}</span>
                  <span className={cn("tabular-nums", over ? "text-destructive" : "text-muted-foreground")}>
                    {formatCents(c.spentCents)} / {formatCents(c.allocatedCents)}
                  </span>
                </div>
                <div className="bg-muted h-2 overflow-hidden rounded-full">
                  <div
                    className={cn("h-full rounded-full", over ? "bg-destructive" : "bg-primary")}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      );
    case "runway":
      return data.runway && period ? (
        <RunwaySection
          runway={data.runway}
          period={period}
          expectedIncomeCents={data.sponsorshipCommittedCents}
          hideHeading
        />
      ) : (
        <ChartEmpty text="No runway to project yet" />
      );
    case "sponsorships":
      return (
        <div className="space-y-2.5 text-sm">
          <div className="flex items-center justify-between gap-2">
            <Badge variant="secondary">Committed</Badge>
            <span className="font-medium tabular-nums">{formatCents(data.sponsorshipCommittedCents)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Badge>Received</Badge>
            <span className="font-medium tabular-nums">{formatCents(data.sponsorshipReceivedCents)}</span>
          </div>
          <p className="text-muted-foreground text-xs">Pledged money never counts toward the balance.</p>
        </div>
      );
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
              <Link href={`${base}/budget`} className="hover:underline">
                Set a budget to see this
              </Link>
            }
          />
        );
      }
      return (
        <Big value={formatCents(left)} sub={`of ${money(data.totalAllocatedCents)} budgeted`} tone={left < 0 ? "bad" : undefined} />
      );
    }
    case "income-sources": {
      const rows = data.incomeByKind.map((k) => ({ label: INCOME_LABEL[k.kind] ?? k.kind, cents: k.cents }));
      if (rows.length === 0) return <ChartEmpty text="No money in yet this period" />;
      const total = rows.reduce((sum, r) => sum + r.cents, 0);
      return (
        <div className="flex flex-col items-center gap-4 sm:flex-row">
          <div className="h-40 w-40 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={rows} dataKey="cents" nameKey="label" innerRadius="58%" outerRadius="100%" paddingAngle={2} stroke="none">
                  {rows.map((r, i) => (
                    <Cell key={r.label} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatCents(Number(value ?? 0))} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="w-full min-w-0 space-y-1.5">
            {rows.map((r, i) => (
              <li key={r.label} className="flex items-center gap-2 text-sm">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                <span className="min-w-0 flex-1 truncate">{r.label}</span>
                <span className="text-muted-foreground tabular-nums">{money(r.cents)}</span>
                <span className="text-muted-foreground w-9 text-right text-xs tabular-nums">
                  {Math.round((r.cents / total) * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case "reimbursements":
      if (data.reimbursementQueue.length === 0) {
        return <ChartEmpty icon={HandCoins} text="Nobody is waiting to be paid back" />;
      }
      return (
        <ul className="divide-y">
          {data.reimbursementQueue.map((t) => (
            <li key={t.id}>
              <Link
                href={`${base}/transactions?status=${t.status}`}
                className="hover:bg-accent/50 -mx-2 flex items-center gap-3 rounded-md px-2 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{t.description}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {t.submitter} · {shortDate.format(new Date(t.occurredAt))}
                  </span>
                </span>
                <Badge variant={t.status === "APPROVED" ? "default" : "secondary"} className="shrink-0 text-[10px]">
                  {STATUS_LABEL[t.status] ?? t.status}
                </Badge>
                <span className="text-sm font-medium tabular-nums">{formatCents(t.amountCents)}</span>
              </Link>
            </li>
          ))}
        </ul>
      );
    case "shortcuts":
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <Shortcut
            href={`${base}/import`}
            icon={FileSpreadsheet}
            label="Import a spreadsheet"
            detail="Bank exports, PDFs, an old sheet"
          />
          <Shortcut href={`${base}/budget`} icon={PiggyBank} label="Budget" detail="What each category may spend" />
          <Shortcut
            href={`${base}/transactions?status=SUBMITTED`}
            icon={ReceiptText}
            label="Requests to review"
            detail={data.pendingApproval.count ? `${data.pendingApproval.count} waiting` : "Nothing waiting"}
          />
          <Shortcut href={`${base}/setup`} icon={ListChecks} label="Setup guide" detail="Budget year, balance, treasurers" />
        </div>
      );
    case "setup": {
      if (!setup) return <ChartEmpty text="Open the setup guide to see what's left" />;
      return (
        <ul className="space-y-1.5">
          {SETUP_STEPS.map((step) => {
            const ok = stepDone(setup, step.id);
            return (
              <li key={step.id}>
                <Link
                  href={`${base}/setup`}
                  className="hover:bg-accent/50 -mx-2 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm"
                >
                  <span
                    className={cn(
                      "grid size-5 shrink-0 place-items-center rounded-full border",
                      ok ? "bg-success border-success text-success-foreground" : "text-muted-foreground",
                    )}
                  >
                    {ok && <Check className="size-3" aria-hidden="true" />}
                  </span>
                  <span className={cn("min-w-0 flex-1 truncate", ok && "text-muted-foreground")}>{step.title}</span>
                  {!ok && !step.core && <span className="text-muted-foreground text-xs">optional</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      );
    }
  }
}
