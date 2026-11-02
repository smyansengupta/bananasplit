"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type ReactNode } from "react";

import { createReportAction } from "@/app/app/[orgSlug]/databases/reports/report-actions";
import { ShapeIcon } from "@/components/boards/shape-picker";
import { WidgetBoard } from "@/components/boards/widget-board";
import { Check, ChevronDown, Globe, Lock } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { shapeName, type BoardWidget } from "@/lib/boards";
import {
  WIDGETS,
  boardTypes,
  newWidget,
  suggestedWidgets,
  widgetTitle,
  widgetUses,
  widgetsFor,
  type ReportWidget,
  type SourceSummary,
  type WidgetType,
} from "@/lib/reports/catalog";
import { cn } from "@/lib/utils";

import { ReportIcon } from "./icons";
import { WidgetSettings } from "./widget-settings";

const STEPS = ["Pick a database", "Pick widgets", "Arrange and share"] as const;

function Stepper({ step, onStep }: { step: number; onStep: (n: number) => void }) {
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="Steps">
      {STEPS.map((label, i) => {
        const done = i < step;
        const on = i === step;
        return (
          <li key={label} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden="true" className="bg-border h-0.5 w-6 sm:w-10" />}
            <button
              type="button"
              disabled={!done}
              onClick={() => onStep(i)}
              aria-current={on ? "step" : undefined}
              className={cn(
                "focus-glow flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-sm font-semibold outline-none",
                on ? "text-foreground" : "text-muted-foreground",
                done && "hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "grid size-7 place-items-center rounded-full text-[13px]",
                  on
                    ? "bg-foreground text-background"
                    : done
                      ? "bg-tint-success text-tint-success-foreground"
                      : "bg-muted",
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden="true" /> : i + 1}
              </span>
              {label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function SourceCard({
  source,
  on,
  onPick,
}: {
  source: SourceSummary;
  on: boolean;
  onPick: () => void;
}) {
  const fields = source.fields
    .slice(0, 5)
    .map((f) => f.name.toLowerCase())
    .join(", ");
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onPick}
      className={cn(
        "bg-card focus-glow rounded-card flex h-full min-w-0 flex-col gap-2 p-4 text-left ring-1 transition-[box-shadow,transform] outline-none",
        on ? "ring-foreground ring-2" : "ring-foreground/8 hover:shadow-e2 hover:-translate-y-0.5",
      )}
    >
      <span className="flex items-center gap-2.5">
        <span className="bg-muted grid size-8 shrink-0 place-items-center rounded-full">
          <ReportIcon name={source.icon} className="size-4" />
        </span>
        <b className="min-w-0 flex-1 truncate">{source.name}</b>
        {on && <Check className="size-4" aria-hidden="true" />}
      </span>
      <span className="text-muted-foreground line-clamp-2 text-[13px]">
        {source.rows.toLocaleString("en-US")}{" "}
        {source.kind === "people"
          ? "members"
          : source.kind === "events"
            ? "events"
            : source.rows === 1
              ? "row"
              : "rows"}
        {fields ? `. ${fields[0].toUpperCase()}${fields.slice(1)}` : `. ${source.description}`}
      </span>
    </button>
  );
}

/**
 * New report, as a walkthrough: pick a database, pick widgets (the ones that
 * suit its fields are already ticked, each saying which field it reads and
 * opening its settings), then arrange them on a board the way Home works,
 * name it and choose who sees it. Nothing is saved until Save report.
 */
export function ReportWizard({
  orgId,
  orgSlug,
  sources,
  isAdmin,
  initialSource,
}: {
  orgId: string;
  orgSlug: string;
  sources: SourceSummary[];
  isAdmin: boolean;
  initialSource: string | null;
}) {
  const router = useRouter();
  const first = sources.find((s) => s.key === initialSource) ?? null;
  const [step, setStep] = useState(first ? 1 : 0);
  const [sourceKey, setSourceKey] = useState<string | null>(first?.key ?? null);
  const source = sources.find((s) => s.key === sourceKey) ?? null;
  const [picked, setPicked] = useState<ReportWidget[]>(() => (first ? suggest(first) : []));
  const [open, setOpen] = useState<string | null>(null);
  const [title, setTitle] = useState(first?.name ?? "");
  const [access, setAccess] = useState<"ORGANIZATION" | "PRIVATE">("ORGANIZATION");
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();

  /** A step starts at its top: the last one may have been scrolled a long way. */
  function go(n: number) {
    setStep(n);
    window.scrollTo({ top: 0 });
  }

  function suggest(s: SourceSummary): ReportWidget[] {
    const out: ReportWidget[] = [];
    for (const t of suggestedWidgets(s, isAdmin)) out.push(newWidget(t, s, out));
    return out;
  }

  function pickSource(s: SourceSummary) {
    if (s.key !== sourceKey) {
      setSourceKey(s.key);
      setPicked(suggest(s));
      setTitle(s.name);
      setOpen(null);
    }
  }

  const available = useMemo(() => (source ? widgetsFor(source, isAdmin) : []), [source, isAdmin]);
  const suggested = useMemo(
    () => new Set(source ? suggestedWidgets(source, isAdmin) : []),
    [source, isAdmin],
  );
  const custom = sources.filter((s) => s.kind === "custom");
  const builtIn = sources.filter((s) => s.kind !== "custom");

  function toggle(type: WidgetType) {
    if (!source || type === "insights") return;
    setPicked((list) => {
      const at = list.findIndex((w) => w.type === type);
      if (at >= 0) return list.filter((_, i) => i !== at);
      return [...list, newWidget(type, source, list)];
    });
  }

  function save() {
    if (!source) return;
    setError(null);
    start(async () => {
      const result = await createReportAction(orgId, {
        title,
        source: source.key,
        access,
        widgets: picked,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/app/${orgSlug}/databases/reports/${result.id}`);
    });
  }

  const back = `/app/${orgSlug}/databases/reports`;
  const footer = (next: ReactNode, onBack?: () => void) => (
    <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t pt-5">
      {onBack ? (
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
      ) : (
        <Button asChild variant="ghost">
          <Link href={back}>Cancel</Link>
        </Button>
      )}
      {next}
    </div>
  );

  const widgetRow = (type: WidgetType) => {
    if (!source) return null;
    const def = WIDGETS[type];
    const w = picked.find((x) => x.type === type);
    const on = Boolean(w);
    const uses = w ? widgetUses(w, source) : [];
    const locked = type === "insights";
    return (
      <li
        key={type}
        className={cn(
          "bg-card rounded-card ring-1 transition-shadow",
          on ? "ring-foreground/40" : "ring-foreground/8",
        )}
      >
        <div className="flex items-center gap-3 p-3.5">
          <button
            type="button"
            role="checkbox"
            aria-checked={on}
            aria-label={def.title}
            disabled={locked}
            onClick={() => toggle(type)}
            className={cn(
              "focus-glow grid size-5 shrink-0 place-items-center rounded-[6px] border-[1.5px] outline-none",
              on ? "bg-foreground border-foreground text-background" : "border-muted-foreground",
            )}
          >
            {on && <Check className="size-3.5" aria-hidden="true" />}
          </button>
          <ReportIcon name={def.icon} className="text-muted-foreground size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            <b className="block text-sm">{w ? widgetTitle(w, source) : def.title}</b>
            <span className="text-muted-foreground block text-[13px]">{def.description}</span>
          </span>
          {locked ? (
            <span className="text-muted-foreground shrink-0 text-xs font-semibold">Always on</span>
          ) : on ? (
            <button
              type="button"
              aria-expanded={open === w!.id}
              onClick={() => setOpen(open === w!.id ? null : w!.id)}
              className="bg-muted hover:bg-muted/70 focus-glow flex h-7 max-w-44 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold outline-none"
            >
              <span className="truncate">{uses.length ? uses.join(", ") : "Settings"}</span>
              <ChevronDown
                className={cn(
                  "size-3.5 shrink-0 transition-transform",
                  open === w!.id && "rotate-180",
                )}
                aria-hidden="true"
              />
            </button>
          ) : null}
        </div>
        {w && open === w.id && (
          <div className="border-border border-t px-4 py-3.5">
            <WidgetSettings
              widget={w}
              source={source}
              onChange={(config) =>
                setPicked((list) => list.map((x) => (x.id === w.id ? { ...x, config } : x)))
              }
            />
          </div>
        )}
      </li>
    );
  };

  const preview = source && (
    <aside
      className="bg-muted/45 rounded-card flex flex-col gap-3 p-4 lg:sticky lg:top-6"
      aria-label="Preview"
    >
      <p className="text-sm font-semibold">
        {picked.length} widget{picked.length === 1 ? "" : "s"}
      </p>
      <div className="grid grid-cols-4 gap-1.5">
        {picked.map((w) => (
          <div
            key={w.id}
            className="bg-card text-muted-foreground flex min-h-10 flex-col justify-between gap-1 rounded-[10px] p-2 text-[11px] leading-tight shadow-sm"
            style={{ gridColumn: `span ${w.w}`, minHeight: `${(w.h ?? 1) * 2.75}rem` }}
          >
            <span className="text-foreground line-clamp-2 font-semibold">
              {widgetTitle(w, source)}
            </span>
            <span className="flex items-center gap-1">
              <ShapeIcon w={w.w} h={w.h} />
              {shapeName(w.w, w.h)}
            </span>
          </div>
        ))}
      </div>
    </aside>
  );

  return (
    <div className="space-y-6">
      <Stepper step={step} onStep={go} />

      {step === 0 && (
        <section className="space-y-5" aria-labelledby="pick-db">
          <div className="space-y-1">
            <h2 id="pick-db" className="heading text-[22px]">
              What&apos;s this report about?
            </h2>
            <p className="text-muted-foreground text-sm">
              Pick any database. You choose what to show from it next.
            </p>
          </div>
          {custom.length > 0 && (
            <div className="space-y-2.5">
              <h3 className="text-muted-foreground text-[13px] font-semibold">Your databases</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {custom.map((s) => (
                  <SourceCard
                    key={s.key}
                    source={s}
                    on={s.key === sourceKey}
                    onPick={() => pickSource(s)}
                  />
                ))}
              </div>
            </div>
          )}
          {builtIn.length > 0 && (
            <div className="space-y-2.5">
              <h3 className="text-muted-foreground text-[13px] font-semibold">
                Built into Bananasplit
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {builtIn.map((s) => (
                  <SourceCard
                    key={s.key}
                    source={s}
                    on={s.key === sourceKey}
                    onPick={() => pickSource(s)}
                  />
                ))}
              </div>
            </div>
          )}
          {footer(
            <Button type="button" disabled={!source} onClick={() => go(1)}>
              Next: pick widgets
            </Button>,
          )}
        </section>
      )}

      {step === 1 && source && (
        <section className="space-y-5" aria-labelledby="pick-widgets">
          <div className="space-y-1">
            <h2 id="pick-widgets" className="heading text-[22px]">
              What should it show?
            </h2>
            <p className="text-muted-foreground text-sm">
              Picked for {source.name} from its fields. Change the field any widget uses.
            </p>
          </div>
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="space-y-5">
              <div className="space-y-2.5">
                <h3 className="text-muted-foreground text-[13px] font-semibold">Suggested</h3>
                <ul className="flex flex-col gap-2">
                  {available.filter((t) => suggested.has(t)).map(widgetRow)}
                </ul>
              </div>
              {available.some((t) => !suggested.has(t)) && (
                <div className="space-y-2.5">
                  <h3 className="text-muted-foreground text-[13px] font-semibold">
                    Also fits {source.name}
                  </h3>
                  <ul className="flex flex-col gap-2">
                    {available
                      .filter((t) => !suggested.has(t))
                      .slice(0, showAll ? undefined : 4)
                      .map(widgetRow)}
                  </ul>
                  {!showAll && available.filter((t) => !suggested.has(t)).length > 4 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAll(true)}
                    >
                      Show all {available.length} widgets
                    </Button>
                  )}
                </div>
              )}
            </div>
            {preview}
          </div>
          {footer(
            <Button type="button" disabled={picked.length === 0} onClick={() => go(2)}>
              Next: arrange and share
            </Button>,
            () => go(0),
          )}
        </section>
      )}

      {step === 2 && source && (
        <section className="space-y-6" aria-labelledby="arrange">
          <WidgetBoard
            key={source.key}
            types={boardTypes(source, isAdmin)}
            initialLayout={picked.map(({ id, type, w, h }) => ({ id, type, w, h }))}
            customized={false}
            titles={Object.fromEntries(picked.map((w) => [w.id, widgetTitle(w, source)]))}
            bodies={Object.fromEntries(
              picked.map((w) => [
                w.id,
                <p key={w.id} className="text-muted-foreground text-sm">
                  {WIDGETS[w.type].description}
                </p>,
              ]),
            )}
            startEditing
            refreshOnSave={false}
            editHint="Arrange it once; anyone who can edit it changes it later."
            intro={
              <h2 id="arrange" className="heading text-[22px]">
                Arrange and share
              </h2>
            }
            onSave={async (layout: BoardWidget[] | null) => {
              if (!layout) return { ok: true };
              setPicked((list) => {
                const byId = new Map(list.map((w) => [w.id, w]));
                return layout.map((b) => {
                  const was = byId.get(b.id);
                  return was
                    ? { ...was, w: b.w, h: b.h }
                    : { ...newWidget(b.type as WidgetType, source, []), id: b.id, w: b.w, h: b.h };
                });
              });
              return { ok: true };
            }}
          />
          <div className="bg-card ring-foreground/6 rounded-card edge grid gap-5 p-6 ring-1 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm">
              <span className="font-semibold">Name</span>
              <Input
                value={title}
                maxLength={80}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={source.name}
              />
            </label>
            <div className="grid gap-1.5 text-sm">
              <span className="font-semibold" id="who-sees">
                Who can see it
              </span>
              <Segmented
                label="Who can see it"
                value={access}
                onSelect={(v) => setAccess(v as "ORGANIZATION" | "PRIVATE")}
                options={[
                  { value: "ORGANIZATION", label: "Everyone", icon: Globe },
                  { value: "PRIVATE", label: "Only you", icon: Lock },
                ]}
                className="w-fit"
              />
              <span className="text-muted-foreground text-xs">
                Each person sees only the {source.name.toLowerCase()} rows they can open themselves.
              </span>
            </div>
          </div>
          {error && (
            <p
              role="alert"
              className="bg-tint-danger text-tint-danger-foreground rounded-tile px-3 py-2 text-sm"
            >
              {error}
            </p>
          )}
          {footer(
            <Button
              type="button"
              disabled={saving || !title.trim() || picked.length === 0}
              onClick={save}
            >
              {saving ? "Saving..." : "Save report"}
            </Button>,
            () => go(1),
          )}
        </section>
      )}
    </div>
  );
}
