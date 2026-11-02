"use client";

import { Plus, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { FieldSelect } from "@/components/ui/field-select";
import { Switch } from "@/components/ui/switch";
import type { SourceSummary } from "@/lib/reports/catalog";
import { matchableFields, type ReportJoin } from "@/lib/reports/join";
import {
  DEFAULT_SCHEDULE,
  WEEKDAYS,
  describeSchedule,
  hourLabel,
  type ReportSchedule,
} from "@/lib/reports/schedule";

const JOINABLE = new Set(["custom", "tasks", "expenses"]);

/** The field of `s` that most likely names a row of `other`: one called like it, else its first. */
function guessField(s: SourceSummary, other: SourceSummary): string {
  const fields = matchableFields(s);
  const stem = other.name.toLowerCase().replace(/s$/, "");
  return (
    fields.find((f) => f.name.toLowerCase().includes(stem))?.id ??
    fields.find((f) => f.type === "TEXT")?.id ??
    fields[0]?.id ??
    ""
  );
}

/**
 * Step 1's "Add a second database": another database joined on a shared
 * field (Expenses' "Paid to" against Sponsors' "Name"), so the report's
 * widgets can use its fields too.
 */
export function JoinPanel({
  base,
  sources,
  join,
  onChange,
}: {
  base: SourceSummary;
  sources: SourceSummary[];
  join: ReportJoin | null;
  onChange: (join: ReportJoin | null) => void;
}) {
  if (!JOINABLE.has(base.kind)) return null;
  const others = sources.filter(
    (s) => s.key !== base.key && JOINABLE.has(s.kind) && matchableFields(s).length > 0,
  );
  if (others.length === 0 || matchableFields(base).length === 0) return null;
  if (!join) {
    return (
      <div className="bg-muted/45 rounded-card flex flex-wrap items-center gap-3 p-4">
        <p className="text-muted-foreground min-w-0 flex-1 basis-72 text-sm">
          Add a second database joined by a shared field, like {base.name} with {others[0].name}, to
          use its fields in this report too.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const other = others[0];
            onChange({
              source: other.key,
              field: guessField(base, other),
              otherField: matchableFields(other)[0]?.id ?? "",
            });
          }}
        >
          <Plus aria-hidden="true" />
          Add one
        </Button>
      </div>
    );
  }
  const other = others.find((s) => s.key === join.source) ?? others[0];
  return (
    <div className="bg-card ring-foreground/8 rounded-card space-y-3 p-4 ring-1">
      <div className="flex items-center gap-2">
        <b className="flex-1 text-sm">Joined with a second database</b>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Remove the second database"
          onClick={() => onChange(null)}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-[13px]">
          <span className="text-muted-foreground font-medium">Second database</span>
          <FieldSelect
            className="w-full"
            value={other.key}
            onChange={(e) => {
              const next = others.find((s) => s.key === e.target.value);
              if (!next) return;
              onChange({
                source: next.key,
                field: guessField(base, next),
                otherField: matchableFields(next)[0]?.id ?? "",
              });
            }}
          >
            {others.map((s) => (
              <option key={s.key} value={s.key}>
                {s.name}
              </option>
            ))}
          </FieldSelect>
        </label>
        <label className="grid gap-1 text-[13px]">
          <span className="text-muted-foreground font-medium">Field in {base.name}</span>
          <FieldSelect
            className="w-full"
            value={join.field}
            onChange={(e) => onChange({ ...join, field: e.target.value })}
          >
            {matchableFields(base).map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </FieldSelect>
        </label>
        <label className="grid gap-1 text-[13px]">
          <span className="text-muted-foreground font-medium">Field in {other.name}</span>
          <FieldSelect
            className="w-full"
            value={join.otherField}
            onChange={(e) => onChange({ ...join, otherField: e.target.value })}
          >
            {matchableFields(other).map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </FieldSelect>
        </label>
      </div>
      <p className="text-muted-foreground text-xs">
        Each {base.name.toLowerCase()} row gets the fields of the {other.name.toLowerCase()} row
        whose{" "}
        {matchableFields(other)
          .find((f) => f.id === join.otherField)
          ?.name.toLowerCase()}{" "}
        reads the same as its{" "}
        {matchableFields(base)
          .find((f) => f.id === join.field)
          ?.name.toLowerCase()}
        .
      </p>
    </div>
  );
}

/** When a report emails itself: a switch, then the day, hour and who. */
export function ScheduleFields({
  schedule,
  onChange,
  shared,
}: {
  schedule: ReportSchedule | null;
  onChange: (schedule: ReportSchedule | null) => void;
  /** A shared report can go to everyone. */
  shared: boolean;
}) {
  const s = schedule ?? DEFAULT_SCHEDULE;
  return (
    <div className="grid gap-3">
      <label className="flex items-center gap-3 text-sm">
        <Switch checked={Boolean(schedule)} onCheckedChange={(on) => onChange(on ? s : null)} />
        <span>
          <b className="block">Send it on a schedule</b>
          <span className="text-muted-foreground text-xs">
            {schedule
              ? `${describeSchedule(schedule)}, keeping a copy each time.`
              : "An email of the report, as each person sees it, and a copy in History."}
          </span>
        </span>
      </label>
      {schedule && (
        <div className="grid gap-3 sm:grid-cols-4">
          <FieldSelect
            className="w-full"
            aria-label="How often"
            value={s.every}
            onChange={(e) => onChange({ ...s, every: e.target.value as "week" | "month", day: 1 })}
          >
            <option value="week">Every week</option>
            <option value="month">Every month</option>
          </FieldSelect>
          <FieldSelect
            className="w-full"
            aria-label="Day"
            value={String(s.day)}
            onChange={(e) => onChange({ ...s, day: Number(e.target.value) })}
          >
            {s.every === "week"
              ? WEEKDAYS.map((d, i) => (
                  <option key={d} value={String(i)}>
                    {d}
                  </option>
                ))
              : Array.from({ length: 28 }, (_, i) => (
                  <option key={i} value={String(i + 1)}>
                    Day {i + 1}
                  </option>
                ))}
          </FieldSelect>
          <FieldSelect
            className="w-full"
            aria-label="Time"
            value={String(s.hour)}
            onChange={(e) => onChange({ ...s, hour: Number(e.target.value) })}
          >
            {Array.from({ length: 15 }, (_, i) => i + 6).map((h) => (
              <option key={h} value={String(h)}>
                {hourLabel(h)}
              </option>
            ))}
          </FieldSelect>
          <FieldSelect
            className="w-full"
            aria-label="Who gets it"
            value={s.to}
            onChange={(e) => onChange({ ...s, to: e.target.value as ReportSchedule["to"] })}
          >
            <option value="me">Just you</option>
            {shared && <option value="admins">Owners and admins</option>}
            {shared && <option value="everyone">Everyone</option>}
          </FieldSelect>
        </div>
      )}
    </div>
  );
}
