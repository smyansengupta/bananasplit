"use client";

import type { ReactNode } from "react";

import { FieldSelect } from "@/components/ui/field-select";
import { Input } from "@/components/ui/input";
import {
  CREATED,
  choiceFields,
  dateFields,
  numberFields,
  type ReportWidget,
  type SourceSummary,
  type WidgetConfig,
} from "@/lib/reports/catalog";

/**
 * A widget's settings, the few each type reads: which number, which choice
 * to split by, which date places a row, a goal's target. The walkthrough
 * shows them under a ticked widget; a report's editors open them from the
 * widget's gear. Every change is handed back whole.
 */
export function WidgetSettings({
  widget,
  source,
  onChange,
}: {
  widget: Pick<ReportWidget, "id" | "type" | "config">;
  source: SourceSummary;
  onChange: (config: WidgetConfig) => void;
}) {
  const c = widget.config;
  const set = (patch: Partial<WidgetConfig>) => onChange({ ...c, ...patch });
  const id = (name: string) => `${widget.id}-${name}`;
  const numbers = numberFields(source);
  const choices = choiceFields(source);
  const dates = dateFields(source);
  const members = source.fields.filter((f) => f.type === "MEMBER");

  const row = (name: string, label: string, control: ReactNode) => (
    <label key={name} htmlFor={id(name)} className="grid gap-1 text-[13px]">
      <span className="text-muted-foreground font-medium">{label}</span>
      {control}
    </label>
  );

  const dateRow = (label = "Date to use") =>
    row(
      "date",
      label,
      <FieldSelect
        className="w-full"
        id={id("date")}
        value={c.date ?? CREATED}
        onChange={(e) => set({ date: e.target.value })}
      >
        <option value={CREATED}>Date added</option>
        {dates.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </FieldSelect>,
    );

  const valueRow = (
    countLabel = `Number of ${source.kind === "custom" ? "rows" : source.name.toLowerCase()}`,
  ) =>
    row(
      "field",
      "Shows",
      <FieldSelect
        className="w-full"
        id={id("field")}
        value={c.field ?? ""}
        onChange={(e) =>
          set({
            field: e.target.value || null,
            agg: e.target.value ? (c.agg === "avg" ? "avg" : "sum") : "count",
          })
        }
      >
        <option value="">{countLabel}</option>
        {numbers.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </FieldSelect>,
    );

  const aggRow = () =>
    c.field
      ? row(
          "agg",
          "Add up as",
          <FieldSelect
            className="w-full"
            id={id("agg")}
            value={c.agg === "avg" ? "avg" : "sum"}
            onChange={(e) => set({ agg: e.target.value as "sum" | "avg" })}
          >
            <option value="sum">Total</option>
            <option value="avg">Average</option>
          </FieldSelect>,
        )
      : null;

  const groupRow = (label: string, withMembers = false) =>
    row(
      "group",
      label,
      <FieldSelect
        className="w-full"
        id={id("group")}
        value={c.group ?? ""}
        onChange={(e) => set({ group: e.target.value })}
      >
        {[...choices, ...(withMembers ? members : [])].map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </FieldSelect>,
    );

  const titleRow = () =>
    row(
      "title",
      "Title",
      <Input
        id={id("title")}
        value={c.title ?? ""}
        placeholder="Made from its fields"
        maxLength={80}
        onChange={(e) => set({ title: e.target.value || undefined })}
      />,
    );

  let rows: ReactNode[] = [];
  switch (widget.type) {
    case "number":
      rows = [valueRow(), aggRow(), dateRow()];
      break;
    case "over-time":
      rows = [
        valueRow(),
        dateRow(),
        row(
          "bucket",
          "By",
          <FieldSelect
            className="w-full"
            id={id("bucket")}
            value={c.bucket ?? "week"}
            onChange={(e) => set({ bucket: e.target.value as "week" | "month" })}
          >
            <option value="week">Week</option>
            <option value="month">Month</option>
          </FieldSelect>,
        ),
      ];
      break;
    case "breakdown":
      rows = [groupRow("Split by", true), valueRow(), dateRow()];
      break;
    case "pipeline":
      rows = [groupRow("Stages from")];
      break;
    case "top-values":
    case "spread":
      rows = [
        row(
          "field",
          "Number",
          <FieldSelect
            className="w-full"
            id={id("field")}
            value={c.field ?? ""}
            onChange={(e) => set({ field: e.target.value })}
          >
            {numbers.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </FieldSelect>,
        ),
        dateRow(),
      ];
      break;
    case "goal":
      rows = [
        valueRow(),
        row(
          "target",
          "Target",
          <Input
            id={id("target")}
            type="number"
            min={1}
            inputMode="decimal"
            value={c.target ?? ""}
            placeholder="How many, or how much"
            onChange={(e) =>
              set({ target: e.target.value ? Math.max(1, Number(e.target.value)) : undefined })
            }
          />,
        ),
        row(
          "by",
          "By",
          <Input
            id={id("by")}
            type="date"
            value={c.by ?? ""}
            onChange={(e) => set({ by: e.target.value || undefined })}
          />,
        ),
        dateRow(),
      ];
      break;
    case "compare":
    case "calendar":
      rows = [dateRow()];
      break;
    case "overdue":
      rows = [
        row(
          "date",
          "Due",
          <FieldSelect
            className="w-full"
            id={id("date")}
            value={c.date ?? ""}
            onChange={(e) => set({ date: e.target.value || undefined })}
          >
            <option value="">No due date</option>
            {dates.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </FieldSelect>,
        ),
        row(
          "owner",
          "Owner",
          <FieldSelect
            className="w-full"
            id={id("owner")}
            value={c.owner ?? ""}
            onChange={(e) => set({ owner: e.target.value || undefined })}
          >
            <option value="">Don&apos;t show owners</option>
            {members.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </FieldSelect>,
        ),
        row(
          "stale",
          "Stale after",
          <FieldSelect
            className="w-full"
            id={id("stale")}
            value={String(c.staleDays ?? 30)}
            onChange={(e) => set({ staleDays: Number(e.target.value) })}
          >
            {[7, 14, 30, 60, 90].map((n) => (
              <option key={n} value={String(n)}>
                {n} days untouched
              </option>
            ))}
          </FieldSelect>,
        ),
      ];
      break;
    case "table": {
      rows = [
        row(
          "filter",
          "Only rows where",
          <FieldSelect
            className="w-full"
            id={id("filter")}
            value={c.filter ? `${c.filter.field}:${c.filter.value}` : ""}
            onChange={(e) => {
              const [field, value] = e.target.value.split(":");
              set({ filter: field && value ? { field, value } : null });
            }}
          >
            <option value="">Every row</option>
            {choices.map((f) => (
              <optgroup key={f.id} label={f.name}>
                {(f.choices ?? []).map((ch) => (
                  <option key={ch.id} value={`${f.id}:${ch.id}`}>
                    {f.name} is {ch.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </FieldSelect>,
        ),
        <fieldset key="columns" className="grid gap-1 text-[13px]">
          <legend className="text-muted-foreground mb-1 font-medium">Columns</legend>
          <div className="flex flex-wrap gap-1.5">
            {source.fields.slice(0, 20).map((f) => {
              const on = (c.columns ?? []).includes(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={on}
                  disabled={!on && (c.columns?.length ?? 0) >= 8}
                  onClick={() =>
                    set({
                      columns: on
                        ? (c.columns ?? []).filter((x) => x !== f.id)
                        : [...(c.columns ?? []), f.id],
                    })
                  }
                  className={
                    on
                      ? "bg-foreground text-background rounded-full px-2.5 py-1 text-xs font-semibold"
                      : "bg-muted text-muted-foreground hover:text-foreground rounded-full px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
                  }
                >
                  {f.name}
                </button>
              );
            })}
          </div>
        </fieldset>,
      ];
      break;
    }
    default:
      rows = [];
  }
  if (widget.type !== "insights") rows.push(titleRow());
  const shown = rows.filter(Boolean);
  if (shown.length === 0) return null;
  return <div className="grid gap-3 sm:grid-cols-2">{shown}</div>;
}
