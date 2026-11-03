import Link from "next/link";
import type { ReactNode } from "react";

import { BarList } from "@/components/reports/bar-list";
import { InsightsCard, splitReading } from "@/components/reports/saved/insights-card";
import { NudgeButton, PushBackButton } from "@/components/tasks/overdue-actions";
import { Stat } from "@/components/reports/stat";
import { CHOICE_COLOR_CLASS } from "@/lib/databases/fields";
import { formatValue, shortDay, type WidgetPayload } from "@/lib/reports/compute";
import { formatCrmValue, type CrmListPayload, type CrmStatPayload } from "@/lib/reports/crm-widgets";
import { cn } from "@/lib/utils";

/**
 * Saved-report widget bodies, one per payload (src/lib/reports/compute.ts).
 * Plain HTML and SVG with no hooks, so the report page renders them on the
 * server and a past report renders its frozen payloads the same way. One
 * series wears --chart-1; a split across choices takes the chart slots in
 * order, so every theme colours them its own way.
 */

const SLOTS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground py-6 text-center text-sm">{children}</p>;
}

function Delta({ pct, label }: { pct: number | null; label?: string }) {
  if (pct === null) return null;
  const flat = Math.abs(pct) < 1;
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
        flat
          ? "bg-muted text-muted-foreground"
          : pct > 0
            ? "bg-tint-success text-tint-success-foreground"
            : "bg-tint-danger text-tint-danger-foreground",
      )}
    >
      {flat ? "Same" : `${pct > 0 ? "+" : ""}${Math.round(pct)}%`}
      {label ? <span className="sr-only"> {label}</span> : null}
    </span>
  );
}

function Spark({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const w = 120;
  const h = 32;
  const step = w / (values.length - 1);
  const points = values.map(
    (v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 4) - 2).toFixed(1)}`,
  );
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-8 w-full max-w-40"
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="var(--chart-1)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** A CRM stat: the number, its change, its parts, and a few rows behind it. */
function CrmStat({ d }: { d: CrmStatPayload }) {
  if (d.empty && (d.value === null || d.value === 0)) {
    return (
      <div className="flex h-full flex-col justify-between gap-3">
        <span className="numeral text-muted-foreground text-[40px] leading-none">{d.value === 0 ? "0" : "None"}</span>
        <span className="text-muted-foreground text-xs">{d.empty}</span>
        {d.parts.length > 0 && (
          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {d.parts.map((p) => (
              <div key={p.label} className="flex gap-1.5">
                <dt className="text-muted-foreground">{p.label}</dt>
                <dd className="font-semibold tabular-nums">{p.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="numeral text-[40px] leading-none">{formatCrmValue(d.value, d.format)}</span>
        <Delta pct={d.deltaPct} label="on the period before" />
      </div>
      <span className="text-muted-foreground text-xs">
        {d.previous !== null ? `${formatCrmValue(d.previous, d.format)} the period before. ` : ""}
        {d.caption}
      </span>
      {d.parts.length > 0 && (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {d.parts.map((p) => (
            <div key={p.label} className="rounded-tile bg-muted/50 px-3 py-2">
              <dt className="text-muted-foreground text-[11px]">{p.label}</dt>
              <dd className="text-sm font-semibold tabular-nums">{p.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {d.rows.length > 0 && (
        <ul className="divide-border -mx-1 divide-y">
          {d.rows.map((r) => (
            <li key={r.key}>
              {r.href ? (
                <Link href={r.href} className="hover:bg-muted/60 rounded-field flex items-baseline gap-2 px-1 py-1.5 text-sm">
                  <b className="min-w-0 flex-1 truncate font-medium">{r.label}</b>
                  {r.detail && <span className="text-muted-foreground shrink-0 text-xs">{r.detail}</span>}
                </Link>
              ) : (
                <span className="flex items-baseline gap-2 px-1 py-1.5 text-sm">
                  <b className="min-w-0 flex-1 truncate font-medium">{r.label}</b>
                  {r.detail && <span className="text-muted-foreground shrink-0 text-xs">{r.detail}</span>}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A CRM ranked list: one bar per row, its value as text. */
function CrmList({ d }: { d: CrmListPayload }) {
  if (d.rows.length === 0) return <Empty>{d.empty}</Empty>;
  return (
    <div className="flex flex-col gap-2">
      {d.caption && <p className="text-muted-foreground text-xs">{d.caption}</p>}
      <BarList
        label={d.caption ?? "CRM"}
        max={d.max ?? undefined}
        items={d.rows.map((r) => ({
          key: r.key,
          label: r.label,
          value: r.value,
          display: r.display,
          detail: r.detail ?? null,
          href: r.href ?? null,
        }))}
      />
    </div>
  );
}

function Columns({
  points,
  format,
  label,
}: {
  points: { key: string; label: string; value: number; previous: number | null }[];
  format: "money" | "number";
  label: string;
}) {
  const max = Math.max(1, ...points.map((p) => Math.max(p.value, p.previous ?? 0)));
  const every = Math.max(1, Math.ceil(points.length / 6));
  return (
    <div className="flex min-h-36 flex-1 flex-col gap-1.5">
      <div className="flex min-h-28 flex-1 items-end gap-[3px]" role="img" aria-label={label}>
        {points.map((p) => (
          <div
            key={p.key}
            className="relative flex h-full min-w-0 flex-1 items-end"
            title={`${p.label}: ${formatValue(p.value, format)}`}
          >
            {p.previous !== null && (
              <span
                className="border-foreground/25 absolute inset-x-0 border-t-2 border-dashed"
                style={{ bottom: `${(p.previous / max) * 100}%` }}
                aria-hidden="true"
              />
            )}
            <span
              className="w-full rounded-t-[5px] rounded-b-[2px]"
              style={{
                height: `${Math.max(p.value ? 3 : 0, (p.value / max) * 100)}%`,
                background: "var(--chart-1)",
              }}
            />
          </div>
        ))}
      </div>
      <div className="text-muted-foreground flex gap-[3px] text-[11px]">
        {points.map((p, i) => (
          <span key={p.key} className="min-w-0 flex-1 overflow-visible whitespace-nowrap">
            {i % every === 0 ? p.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

export function WidgetBody({
  payload,
  insights,
  taskActions,
}: {
  payload: WidgetPayload;
  /**
   * Insights' extras on the live report: the database it reads, and (for
   * whoever may use them) Rewrite and the ask box. A kept copy has none.
   */
  insights?: { on?: string; rewrite?: ReactNode; ask?: ReactNode };
  /** Nudge and Push back on late tasks (the live report; a kept copy has none). */
  taskActions?: { orgId: string; viewerId: string };
}) {
  switch (payload.type) {
    case "insights": {
      const d = payload.data;
      const { lead, lines, next } = splitReading(d);
      const by =
        d.byClaude && d.at
          ? `written by Claude, ${new Date(d.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
          : "from this report's numbers";
      return (
        <InsightsCard
          className="min-h-0 flex-1 overflow-auto"
          subtitle={insights?.on ? `On ${insights.on}, ${by}` : by[0].toUpperCase() + by.slice(1)}
          lead={lead}
          lines={lines.map((l) => ({
            ...l,
            href: l.widgetId ? `#w-${l.widgetId}` : null,
          }))}
          next={next}
          rewrite={insights?.rewrite}
          ask={insights?.ask}
          foot={
            insights?.ask
              ? "Reads only what's on this report, and only what you can see."
              : undefined
          }
        />
      );
    }
    case "number": {
      const d = payload.data;
      return (
        <div className="flex h-full flex-col justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="numeral text-[40px] leading-none">
              {formatValue(d.value, d.format)}
            </span>
            <Delta pct={d.deltaPct} label={`on ${d.previousLabel ?? "the period before"}`} />
          </div>
          <div className="flex items-end justify-between gap-3">
            <span className="text-muted-foreground text-xs">
              {d.previous !== null
                ? `${formatValue(d.previous, d.format)} ${d.previousLabel ?? "the period before"}`
                : d.unit}
            </span>
            <Spark values={d.spark} label="By week" />
          </div>
        </div>
      );
    }
    case "over-time": {
      const d = payload.data;
      if (d.points.every((p) => p.value === 0)) return <Empty>Nothing in these dates.</Empty>;
      return (
        <div className="flex h-full flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="numeral text-[26px]">{formatValue(d.total, d.format)}</span>
            {d.previousTotal !== null && (
              <span className="text-muted-foreground text-xs">
                against {formatValue(d.previousTotal, d.format)}{" "}
                {d.previousLabel ?? "the period before"} (dashed)
              </span>
            )}
            {d.clipped && (
              <span className="text-muted-foreground text-xs">
                The newest {d.points.length} {d.bucket}s
              </span>
            )}
          </div>
          <Columns points={d.points} format={d.format} label={`By ${d.bucket}`} />
        </div>
      );
    }
    case "breakdown": {
      const d = payload.data;
      if (d.rows.length === 0) return <Empty>Nothing in these dates.</Empty>;
      return (
        <div className="flex flex-col gap-3">
          <div
            className={cn("flex h-3 overflow-hidden rounded-full", d.multi && "hidden")}
            aria-hidden="true"
          >
            {d.rows.map((r, i) => (
              <span
                key={r.id}
                style={{ width: `${r.share}%`, background: SLOTS[i % SLOTS.length] }}
                className="h-full"
              />
            ))}
          </div>
          <ul className="flex flex-col gap-1.5">
            {d.rows.map((r, i) => (
              <li key={r.id} className="flex items-center gap-2.5 text-sm">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: SLOTS[i % SLOTS.length] }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate">{r.label}</span>
                <span className="text-muted-foreground tabular-nums">{Math.round(r.share)}%</span>
                <span className="w-20 text-right font-semibold tabular-nums">
                  {formatValue(r.value, d.format)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case "pipeline": {
      const d = payload.data;
      if (d.total === 0) return <Empty>No rows yet.</Empty>;
      const top = Math.max(1, ...d.stages.map((s) => s.reached));
      return (
        <div className="flex flex-col gap-2">
          {d.stages.map((s, i) => {
            return (
              <div
                key={s.id}
                className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_2.5rem] items-center gap-3 text-sm sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)_7.5rem]"
              >
                <span className="truncate font-medium">{s.label}</span>
                <span className="bg-muted h-6 overflow-hidden rounded-full" aria-hidden="true">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${Math.max(s.count ? 4 : 0, (s.count / top) * 100)}%`,
                      background: "var(--chart-1)",
                    }}
                  />
                </span>
                <span className="text-right tabular-nums">
                  <b>{s.count}</b>
                  {/* The first stage is everyone; from the second on, the share that got this far. */}
                  {i > 0 && (
                    <span className="text-muted-foreground ms-2 inline-block w-20 text-xs max-sm:hidden">
                      {Math.round((s.reached / Math.max(1, d.stages[0]?.reached ?? 0)) * 100)}% got
                      here
                    </span>
                  )}
                </span>
              </div>
            );
          })}
          {(d.off.length > 0 || d.unset > 0) && (
            <p className="text-muted-foreground text-xs">
              {[
                ...d.off.map((o) => `${o.count} ${o.label.toLowerCase()}`),
                ...(d.unset > 0 ? [`${d.unset} with no stage set`] : []),
              ].join(", ")}
            </p>
          )}
        </div>
      );
    }
    case "top-values": {
      const d = payload.data;
      if (d.rows.length === 0) return <Empty>No values in these dates.</Empty>;
      return (
        <BarList
          label="Top values"
          items={d.rows.map((r) => ({
            key: r.id,
            label: r.title,
            value: r.value,
            display: formatValue(r.value, d.format),
            href: r.href,
          }))}
        />
      );
    }
    case "goal": {
      const d = payload.data;
      const pct = Math.min(100, d.pct ?? 0);
      return (
        <div className="flex h-full flex-col justify-between gap-3">
          <div>
            <span className="numeral text-[34px] leading-none">
              {formatValue(d.value, d.format)}
            </span>
            {d.target !== null ? (
              <span className="text-muted-foreground ms-1.5 text-sm">
                of {formatValue(d.target, d.format)}
              </span>
            ) : null}
          </div>
          {d.target === null ? (
            <p className="text-muted-foreground text-sm">
              Set a target in the widget&apos;s settings.
            </p>
          ) : (
            <div className="space-y-1.5">
              <div className="bg-muted h-2.5 overflow-hidden rounded-full" aria-hidden="true">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    background: pct >= 100 ? "var(--chart-3)" : "var(--chart-1)",
                  }}
                />
              </div>
              <p className="text-muted-foreground text-xs">
                {d.pct}%{d.perWeek ? `. ${formatValue(d.perWeek, d.format)} a week gets there` : ""}
                {d.by ? ` by ${shortDay(d.by)}` : ""}
              </p>
            </div>
          )}
        </div>
      );
    }
    case "compare": {
      const d = payload.data;
      if (!d.hasBefore)
        return (
          <Empty>All time has nothing before it to compare. Pick a quarter, a year or dates.</Empty>
        );
      return (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground text-left text-xs">
              <th className="pb-2 font-semibold">&nbsp;</th>
              <th className="pb-2 text-right font-semibold">Now</th>
              <th className="pb-2 text-right font-semibold">Before</th>
              <th className="pb-2 text-right font-semibold">Change</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.label} className="border-border border-t">
                <td className="py-2 pr-2">{r.label}</td>
                <td className="py-2 text-right font-semibold tabular-nums">
                  {r.label === "Finished" ? `${r.now}%` : formatValue(r.now, r.format)}
                </td>
                <td className="text-muted-foreground py-2 text-right tabular-nums">
                  {r.label === "Finished" ? `${r.before}%` : formatValue(r.before, r.format)}
                </td>
                <td className="py-2 text-right">
                  <Delta pct={r.deltaPct} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    case "calendar": {
      const d = payload.data;
      const shade = (n: number) =>
        n === 0
          ? "var(--muted)"
          : `color-mix(in oklab, var(--chart-3) ${Math.round(30 + (n / Math.max(1, d.max)) * 70)}%, var(--card))`;
      return (
        <div className="flex flex-col gap-2">
          <div
            className="flex gap-[3px] overflow-x-auto pb-1"
            role="img"
            aria-label={`${d.total} in these dates${d.busiestWeekday ? `; ${d.busiestWeekday}s are busiest` : ""}`}
          >
            {d.weeks.map((week) => (
              <div key={week[0].date} className="flex shrink-0 flex-col gap-[3px]">
                {week.map((day) => (
                  <span
                    key={day.date}
                    className="size-3 rounded-[3px]"
                    style={{ background: shade(day.count) }}
                    title={`${shortDay(day.date)}: ${day.count}`}
                  />
                ))}
              </div>
            ))}
          </div>
          <p className="text-muted-foreground text-xs">
            {d.total} in these dates
            {d.busiestWeekday ? `. ${d.busiestWeekday}s are the busiest.` : "."}
          </p>
        </div>
      );
    }
    case "overdue": {
      const d = payload.data;
      if (d.overdueCount === 0 && d.staleCount === 0)
        return <Empty>Nothing overdue or stale.</Empty>;
      const row = (
        r: {
          id: string;
          title: string;
          href: string | null;
          owner: string | null;
          ownerId: string | null;
        },
        sub: string,
        tag: string,
        late: boolean,
      ) => {
        const body = (
          <>
            <span className="min-w-0 flex-1">
              <b className="line-clamp-2 block text-sm break-words">{r.title}</b>
              <span className="text-muted-foreground text-xs">{sub}</span>
            </span>
            <span className="bg-tint-danger text-tint-danger-foreground shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold">
              {tag}
            </span>
          </>
        );
        // A late task gets Nudge (someone else's) and Push back, on the live report only.
        const actions =
          d.tasks && taskActions ? (
            <span className="flex shrink-0 items-center gap-1.5 max-sm:ms-auto max-sm:pb-2">
              {r.ownerId && r.ownerId !== taskActions.viewerId && (
                <NudgeButton
                  orgId={taskActions.orgId}
                  taskId={r.id}
                  person={{ id: r.ownerId, name: r.owner }}
                />
              )}
              {late && (
                <PushBackButton
                  orgId={taskActions.orgId}
                  taskId={r.id}
                  title={r.title}
                  size="icon-sm"
                />
              )}
            </span>
          ) : null;
        return (
          <div className="flex flex-wrap items-center gap-x-2">
            {r.href ? (
              <Link
                href={r.href}
                className="hover:bg-muted/60 focus-glow rounded-field -mx-2 flex min-w-0 flex-1 items-center gap-3 px-2 py-2 outline-none"
              >
                {body}
              </Link>
            ) : (
              <div className="flex min-w-0 flex-1 items-center gap-3 py-2">{body}</div>
            )}
            {actions}
          </div>
        );
      };
      return (
        <div className="flex flex-col gap-1">
          {d.overdue.map((r) => (
            <div key={r.id}>
              {row(
                r,
                `${r.owner ?? "No owner"}. Due ${shortDay(r.date)}`,
                `${r.daysLate} ${r.daysLate === 1 ? "day" : "days"} late`,
                true,
              )}
            </div>
          ))}
          {d.stale.slice(0, Math.max(0, 6 - d.overdue.length)).map((r) => (
            <div key={r.id}>
              {row(
                r,
                r.owner ?? "No owner",
                `${r.days} ${r.days === 1 ? "day" : "days"} untouched`,
                false,
              )}
            </div>
          ))}
          <p className="text-muted-foreground pt-1 text-xs">
            {d.overdueCount} past due, {d.staleCount} untouched for {d.staleDays} days or more
          </p>
        </div>
      );
    }
    case "table": {
      const d = payload.data;
      return (
        <div className="flex flex-col gap-2">
          {d.filterLabel && (
            <span className="bg-tint-info text-tint-info-foreground self-start rounded-full px-2.5 py-0.5 text-xs font-semibold">
              {d.filterLabel}
            </span>
          )}
          {d.rows.length === 0 ? (
            <Empty>No rows match.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-left text-xs">
                    {d.columns.map((c) => (
                      <th
                        key={c.id}
                        className={cn(
                          "pr-3 pb-2 font-semibold whitespace-nowrap",
                          c.numeric && "text-right",
                        )}
                      >
                        {c.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((r) => (
                    <tr key={r.id} className="border-border border-t">
                      {r.cells.map((cell, i) => (
                        <td
                          key={i}
                          className={cn(
                            "py-2 pr-3",
                            i === 0 && "font-semibold",
                            d.columns[i]?.numeric && "text-right tabular-nums",
                          )}
                        >
                          {cell || <span className="text-muted-foreground">-</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-muted-foreground text-xs">
            {d.rows.length < d.total
              ? `The newest ${d.rows.length} of ${d.total}`
              : `${d.total} ${d.total === 1 ? "row" : "rows"}`}
          </p>
        </div>
      );
    }
    case "spread": {
      const d = payload.data;
      if (d.count === 0) return <Empty>No values in these dates.</Empty>;
      const max = Math.max(1, ...d.bins.map((b) => b.count));
      return (
        <div className="flex h-full flex-col gap-3">
          <div className="flex flex-wrap gap-5">
            {[
              ["median", d.median],
              ["average", d.average],
              ["largest", d.max],
            ].map(([label, v]) => (
              <span key={label as string}>
                <span className="numeral block text-[22px]">
                  {formatValue((v as number) ?? 0, d.format)}
                </span>
                <span className="text-muted-foreground text-xs">{label}</span>
              </span>
            ))}
          </div>
          <div className="flex min-h-24 flex-1 items-end gap-1.5">
            {d.bins.map((b) => (
              <div
                key={b.label}
                className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
                title={`${b.label}: ${b.count}`}
              >
                <span
                  className="w-full rounded-t-[5px] rounded-b-[2px]"
                  style={{
                    height: `${Math.max(b.count ? 4 : 0, (b.count / max) * 100)}%`,
                    background: "var(--chart-1)",
                  }}
                />
                <span className="text-muted-foreground w-full truncate text-center text-[10.5px]">
                  {b.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    case "health": {
      const d = payload.data;
      const ok = d.duplicates.length === 0 && d.empty.length === 0;
      return (
        <div className="flex flex-col gap-2.5">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Rows" value={d.rows.toLocaleString("en-US")} />
            <Stat label="Repeated names" value={d.duplicates.length} />
            <Stat label="Untouched a year" value={d.untouched} />
          </div>
          {ok ? (
            <p className="text-muted-foreground text-sm">
              No repeated names, and every field is mostly filled in.
            </p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {d.duplicates.map((x) => (
                <li key={x.title}>
                  <b>{x.title}</b>{" "}
                  <span className="text-muted-foreground">appears {x.count} times</span>
                </li>
              ))}
              {d.empty.map((x) => (
                <li key={x.field}>
                  <b>{x.field}</b>{" "}
                  <span className="text-muted-foreground">is empty on {x.pct}% of rows</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    }
    case "form-results": {
      const d = payload.data;
      if (d.responses === 0) return <Empty>No answers in these dates.</Empty>;
      return (
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            <b className="numeral text-[22px]">{d.responses}</b>{" "}
            <span className="text-muted-foreground">
              {d.responses === 1 ? "answer" : "answers"}
            </span>
          </p>
          {d.questions.map((q) => (
            <section key={q.id} className="flex flex-col gap-1.5">
              <h3 className="text-sm font-semibold">{q.label}</h3>
              {q.options.map((o) => (
                <div key={o.label} className="flex items-center gap-2.5 text-sm">
                  <span
                    className={cn(
                      "w-28 truncate rounded-full px-2 py-0.5 text-xs font-semibold",
                      o.color ? CHOICE_COLOR_CLASS[o.color] : "bg-muted",
                    )}
                  >
                    {o.label}
                  </span>
                  <span
                    className="bg-muted h-2 flex-1 overflow-hidden rounded-full"
                    aria-hidden="true"
                  >
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${o.share}%`, background: "var(--chart-1)" }}
                    />
                  </span>
                  <span className="w-10 text-right tabular-nums">{o.share}%</span>
                </div>
              ))}
            </section>
          ))}
          <p className="text-muted-foreground text-xs">Free-text answers never show here.</p>
        </div>
      );
    }
    case "crm-reached":
    case "crm-reply-rate":
    case "crm-first-reply":
    case "crm-overdue":
    case "crm-cold":
    case "crm-velocity":
      return <CrmStat d={payload.data} />;
    case "crm-by-member":
    case "crm-campaigns":
    case "crm-conversion":
    case "crm-time-in-stage":
    case "crm-by-source":
    case "crm-raised-by-source":
    case "crm-goals":
      return <CrmList d={payload.data} />;
    case "journey": {
      const d = payload.data;
      const first = d.steps[0]?.count ?? 0;
      if (first === 0) return <Empty>Nobody signed up in these dates.</Empty>;
      return (
        <div className="flex flex-col gap-2">
          {d.steps.map((s) => (
            <div
              key={s.label}
              className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_4.5rem] items-center gap-3 text-sm sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)_5.5rem]"
            >
              <span className="truncate font-medium">{s.label}</span>
              <span className="bg-muted h-6 overflow-hidden rounded-full" aria-hidden="true">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${Math.max(s.count ? 4 : 0, (s.count / first) * 100)}%`,
                    background: "var(--chart-1)",
                  }}
                />
              </span>
              <span className="text-right tabular-nums">
                <b>{s.count}</b>
                <span className="text-muted-foreground ms-2 inline-block w-10 text-xs">
                  {Math.round((s.count / first) * 100)}%
                </span>
              </span>
            </div>
          ))}
        </div>
      );
    }
    case "reach": {
      const d = payload.data;
      if (d.rows.length === 0) return <Empty>No signups with a year on them yet.</Empty>;
      return (
        <div className="flex flex-col gap-3">
          <BarList
            label="Who came, by the year on their signup"
            items={d.rows.map((r) => ({
              key: r.label,
              label: r.label,
              value: r.came,
              display: `${r.came} of ${r.signedUp}`,
              detail: r.signedUp
                ? `${Math.round((r.came / r.signedUp) * 100)}% of those who signed up came`
                : null,
            }))}
          />
        </div>
      );
    }
    case "when": {
      const d = payload.data;
      if (d.cells.length === 0) return <Empty>No events with check-ins in these dates.</Empty>;
      const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      const slots = ["morning", "afternoon", "evening"] as const;
      const max = Math.max(1, ...d.cells.map((c) => c.average));
      const cell = (wd: number, slot: (typeof slots)[number]) =>
        d.cells.find((c) => c.weekday === wd && c.slot === slot);
      return (
        <div className="flex flex-col gap-3">
          <div className="overflow-x-auto">
            <table className="w-full text-center text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="pb-1.5" />
                  {days.map((day) => (
                    <th key={day} className="pb-1.5 font-semibold">
                      {day}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slots.map((slot) => (
                  <tr key={slot}>
                    <th className="text-muted-foreground pr-2 text-left font-semibold capitalize">
                      {slot}
                    </th>
                    {days.map((day, wd) => {
                      const c = cell(wd, slot);
                      return (
                        <td key={day} className="p-0.5">
                          <span
                            className="grid h-9 place-items-center rounded-[8px] font-semibold tabular-nums"
                            style={{
                              background: c
                                ? `color-mix(in oklab, var(--chart-1) ${Math.round(18 + (c.average / max) * 62)}%, var(--card))`
                                : "var(--muted)",
                              color: c && c.average / max > 0.6 ? "var(--card)" : undefined,
                            }}
                            title={
                              c
                                ? `${c.events} ${c.events === 1 ? "event" : "events"}, ${c.average} a session`
                                : "No events"
                            }
                          >
                            {c ? Math.round(c.average) : ""}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.best && (
            <p className="text-muted-foreground text-xs">
              {days[d.best.weekday]} {d.best.slot}s draw the most: {d.best.average} a session over{" "}
              {d.best.events} event{d.best.events === 1 ? "" : "s"}.
            </p>
          )}
        </div>
      );
    }
    case "regulars": {
      const d = payload.data;
      if (d.rows.length === 0) return <Empty>Nobody checked in during these dates.</Empty>;
      return (
        <ol className="flex flex-col gap-1.5">
          {d.rows.map((r, i) => (
            <li key={r.id} className="flex items-center gap-2.5 text-sm">
              <span className="text-muted-foreground w-4 text-right text-xs tabular-nums">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
              <span className="font-semibold tabular-nums">
                {r.checkIns}
                <span className="text-muted-foreground ms-1 text-xs font-normal">check-ins</span>
              </span>
            </li>
          ))}
        </ol>
      );
    }
    case "stopped": {
      const d = payload.data;
      if (d.total === 0) return <Empty>Nobody who came often has stopped.</Empty>;
      const invite =
        d.emails.length > 0
          ? `mailto:?bcc=${encodeURIComponent(d.emails.join(","))}&subject=${encodeURIComponent("We miss you")}`
          : null;
      return (
        <div className="flex flex-col gap-2">
          <ul className="divide-border divide-y">
            {d.rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <b className="block truncate">{r.name}</b>
                  <span className="text-muted-foreground text-xs">
                    Came {r.sessions} times{r.lastDate ? `, last on ${shortDay(r.lastDate)}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground text-xs">
              {d.total} {d.total === 1 ? "regular has" : "regulars have"} stopped coming
            </span>
            {invite && (
              <a
                href={invite}
                className="bg-foreground text-background focus-glow rounded-full px-3.5 py-1.5 text-xs font-semibold outline-none"
              >
                Invite {d.emails.length === 1 ? "them" : `all ${d.emails.length}`} back
              </a>
            )}
          </div>
        </div>
      );
    }
  }
}
