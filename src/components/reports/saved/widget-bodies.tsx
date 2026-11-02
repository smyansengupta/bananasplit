import Link from "next/link";
import type { ReactNode } from "react";

import { BarList } from "@/components/reports/bar-list";
import { Stat } from "@/components/reports/stat";
import { CHOICE_COLOR_CLASS } from "@/lib/databases/fields";
import { formatValue, shortDay, type InsightLine, type WidgetPayload } from "@/lib/reports/compute";
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

function Lines({ lines }: { lines: InsightLine[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {lines.map((l, i) => (
        <li key={i} className="flex items-start gap-2.5 text-[15px] leading-snug">
          <span
            aria-hidden="true"
            className={cn(
              "mt-1 size-2.5 shrink-0 rounded-full",
              l.tone === "warn"
                ? "bg-[var(--chart-4)]"
                : l.tone === "good"
                  ? "bg-[var(--chart-3)]"
                  : "bg-[var(--chart-1)]",
            )}
          />
          <span>
            {l.text}
            {l.widgetId ? (
              <a
                href={`#w-${l.widgetId}`}
                className="text-muted-foreground hover:text-foreground ms-1.5 text-[13px] underline-offset-2 hover:underline"
              >
                See it
              </a>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function WidgetBody({
  payload,
  insightsAction,
}: {
  payload: WidgetPayload;
  /** Insights' Ask Claude button (the report page passes it to people who may use it). */
  insightsAction?: ReactNode;
}) {
  switch (payload.type) {
    case "insights": {
      const d = payload.data;
      return (
        <div className="flex flex-col gap-3">
          {d.lines.length ? (
            <Lines lines={d.lines} />
          ) : (
            <p className="text-muted-foreground text-sm">
              Nothing stands out yet. Add rows, or widgets with numbers, and this fills in.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-muted-foreground text-xs">
              {d.byClaude && d.at
                ? `Written by Claude on ${new Date(d.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                : "From the numbers below"}
            </span>
            {insightsAction}
          </div>
        </div>
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
            <Delta pct={d.deltaPct} label={`on ${d.previousLabel ?? "the span before"}`} />
          </div>
          <div className="flex items-end justify-between gap-3">
            <span className="text-muted-foreground text-xs">
              {d.previous !== null
                ? `${formatValue(d.previous, d.format)} in ${d.previousLabel ?? "the span before"}`
                : d.unit}
            </span>
            <Spark values={d.spark} label="By week" />
          </div>
        </div>
      );
    }
    case "over-time": {
      const d = payload.data;
      if (d.points.every((p) => p.value === 0)) return <Empty>Nothing in this span.</Empty>;
      return (
        <div className="flex h-full flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="numeral text-[26px]">{formatValue(d.total, d.format)}</span>
            {d.previousTotal !== null && (
              <span className="text-muted-foreground text-xs">
                against {formatValue(d.previousTotal, d.format)} in{" "}
                {d.previousLabel ?? "the span before"} (dashed)
              </span>
            )}
          </div>
          <Columns points={d.points} format={d.format} label={`By ${d.bucket}`} />
        </div>
      );
    }
    case "breakdown": {
      const d = payload.data;
      if (d.rows.length === 0) return <Empty>Nothing in this span.</Empty>;
      return (
        <div className="flex flex-col gap-3">
          <div className="flex h-3 overflow-hidden rounded-full" aria-hidden="true">
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
          {d.stages.map((s) => {
            return (
              <div
                key={s.id}
                className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm"
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
                  <span className="text-muted-foreground ms-2 inline-block w-20 text-xs">
                    {Math.round((s.reached / Math.max(1, d.stages[0]?.reached ?? 0)) * 100)}% got
                    here
                  </span>
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
      if (d.rows.length === 0) return <Empty>No values in this span.</Empty>;
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
      if (!d.hasBefore) return <Empty>All time has no span before it. Pick a term or dates.</Empty>;
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
            aria-label={`${d.total} in this span${d.busiestWeekday ? `; ${d.busiestWeekday}s are busiest` : ""}`}
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
            {d.total} in all{d.busiestWeekday ? `. ${d.busiestWeekday}s are the busiest.` : "."}
          </p>
        </div>
      );
    }
    case "overdue": {
      const d = payload.data;
      if (d.overdueCount === 0 && d.staleCount === 0)
        return <Empty>Nothing overdue or stale.</Empty>;
      const row = (title: string, href: string | null, sub: string, tag: string) => {
        const body = (
          <>
            <span className="min-w-0 flex-1">
              <b className="block truncate text-sm">{title}</b>
              <span className="text-muted-foreground text-xs">{sub}</span>
            </span>
            <span className="bg-tint-danger text-tint-danger-foreground shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold">
              {tag}
            </span>
          </>
        );
        return href ? (
          <Link
            href={href}
            className="hover:bg-muted/60 focus-glow rounded-field -mx-2 flex items-center gap-3 px-2 py-2 outline-none"
          >
            {body}
          </Link>
        ) : (
          <div className="flex items-center gap-3 py-2">{body}</div>
        );
      };
      return (
        <div className="flex flex-col gap-1">
          {d.overdue.map((r) => (
            <div key={r.id}>
              {row(
                r.title,
                r.href,
                `${r.owner ?? "No owner"}. Due ${shortDay(r.date)}`,
                `${r.daysLate} days late`,
              )}
            </div>
          ))}
          {d.stale.slice(0, Math.max(0, 6 - d.overdue.length)).map((r) => (
            <div key={r.id}>
              {row(r.title, r.href, r.owner ?? "No owner", `${r.days} days untouched`)}
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
              : `${d.total} rows`}
          </p>
        </div>
      );
    }
    case "spread": {
      const d = payload.data;
      if (d.count === 0) return <Empty>No values in this span.</Empty>;
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
      if (d.responses === 0) return <Empty>No answers in this span.</Empty>;
      return (
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            <b className="numeral text-[22px]">{d.responses}</b>{" "}
            <span className="text-muted-foreground">answers</span>
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
  }
}
