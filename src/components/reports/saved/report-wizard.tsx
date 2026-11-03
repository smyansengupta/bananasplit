"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type ReactNode } from "react";

import { createReportAction } from "@/app/app/[orgSlug]/databases/reports/report-actions";
import { WidgetBoard } from "@/components/boards/widget-board";
import { Check, ChevronDown } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BoardWidget } from "@/lib/boards";
import {
  WIDGETS,
  boardTypes,
  fillRows,
  naturalSize,
  newWidget,
  suggestedLayout,
  suggestedWidgets,
  widgetTitle,
  widgetUses,
  widgetsFor,
  type ReportWidget,
  type SourceSummary,
  type WidgetType,
} from "@/lib/reports/catalog";
import { joinedSummary, type ReportJoin } from "@/lib/reports/join";
import { cn } from "@/lib/utils";

import { ReportIcon } from "./icons";
import { JoinPanel } from "./report-options";
import {
  AccessPicker,
  CopyField,
  OutsideSharing,
  useDraftSharing,
  type ReportAccessChoice,
} from "./share-fields";
import { WidgetSettings } from "./widget-settings";

const toLayout = (widgets: readonly ReportWidget[]): BoardWidget[] =>
  widgets.map(({ id, type, w, h }) => ({ id, type, w, h }));

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
        <b className="min-w-0 flex-1 leading-snug break-words">{source.name}</b>
        {on && <Check className="size-4" aria-hidden="true" />}
      </span>
      <span className="text-muted-foreground line-clamp-2 text-[13px]">
        {source.rows.toLocaleString("en-US")}{" "}
        {source.kind === "people"
          ? "people"
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
 * opening its settings), then arrange them on a board the way Home works.
 * Save report asks who sees it, in the organization and outside it. Nothing
 * is saved until then.
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
  const base = sources.find((s) => s.key === sourceKey) ?? null;
  const [join, setJoin] = useState<ReportJoin | null>(null);
  const joined = join ? sources.find((s) => s.key === join.source) : null;
  // The widgets read the joined database's fields too.
  const source = useMemo(
    () => (base && join && joined ? joinedSummary(base, joined, join) : base),
    [base, join, joined],
  );
  const [picked, setPicked] = useState<ReportWidget[]>(() => (first ? suggest(first) : []));
  const [open, setOpen] = useState<string | null>(null);
  const [title, setTitle] = useState(first?.name ?? "");
  const [access, setAccess] = useState<ReportAccessChoice>("ORGANIZATION");
  const sharing = useDraftSharing();
  const [asking, setAsking] = useState(false);
  /** Saved with its link on: the link, shown once, before going to the report. */
  const [made, setMade] = useState<{ id: string; link: string } | null>(null);
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
      setJoin(null);
      setPicked(suggest(s));
      setTitle(s.name);
      setOpen(null);
    }
  }

  // The widgets at their catalog sizes, in full rows with no gaps.
  const arranged = useMemo(() => fillRows(picked.map(naturalSize)), [picked]);

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
        join,
        share:
          access === "ORGANIZATION" ? { link: sharing.link, invites: sharing.invites } : undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.link) {
        setMade({ id: result.id, link: result.link });
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
        <div className="flex flex-wrap items-center gap-3 p-3.5">
          <button
            type="button"
            role="checkbox"
            aria-checked={on}
            aria-label={def.title}
            disabled={locked}
            onClick={() => toggle(type)}
            className={cn(
              "focus-glow relative grid size-5 shrink-0 place-items-center rounded-[6px] border-[1.5px] outline-none after:absolute after:-inset-2.5 after:content-['']",
              on ? "bg-foreground border-foreground text-background" : "border-muted-foreground",
            )}
          >
            {on && <Check className="size-3.5" aria-hidden="true" />}
          </button>
          <ReportIcon name={def.icon} className="text-muted-foreground size-4 shrink-0" />
          <span className="min-w-0 flex-1 basis-40">
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
              className="bg-muted hover:bg-muted/70 focus-glow flex h-8 max-w-full shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold outline-none max-sm:ms-8 sm:max-w-44"
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

  return (
    <div className="space-y-6">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={80}
        aria-label="Report name"
        placeholder="Name your report"
        className="page-title placeholder:text-muted-foreground/60 -mx-1 w-full rounded-[10px] bg-transparent px-1 outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      />

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
              <h3 className="text-muted-foreground text-[13px] font-semibold">Built in</h3>
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
          {base && (
            <JoinPanel
              base={base}
              sources={sources}
              join={join}
              onChange={(next) => {
                setJoin(next);
                const other = next ? sources.find((s) => s.key === next.source) : null;
                setPicked(suggest(next && other ? joinedSummary(base, other, next) : base));
                setOpen(null);
              }}
            />
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
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowAll(true)}>
                    Show all {available.length} widgets
                  </Button>
                )}
              </div>
            )}
          </div>
          {footer(
            <Button
              type="button"
              disabled={picked.length === 0}
              onClick={() => {
                setPicked(arranged);
                go(2);
              }}
            >
              Next: arrange
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
            initialLayout={toLayout(picked)}
            customized
            titles={Object.fromEntries(picked.map((w) => [w.id, widgetTitle(w, source)]))}
            bodies={Object.fromEntries(
              picked.map((w) => [
                w.id,
                <p key={w.id} className="text-muted-foreground text-sm">
                  {WIDGETS[w.type].description}
                </p>,
              ]),
            )}
            // A phone arranges by the grips once Customize is on; it doesn't start there.
            startEditing={
              typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches
            }
            refreshOnSave={false}
            noun="this report"
            fillGaps
            editHint="Add, remove and arrange the widgets here."
            resetLabel="Back to the suggested widgets"
            intro={
              <h2 id="arrange" className="heading text-[22px]">
                Arrange it
              </h2>
            }
            onSave={async (layout: BoardWidget[] | null) => {
              if (!layout) {
                // Reset: the suggested widgets, laid out afresh; Undo brings these back.
                const before = picked;
                const suggested = suggestedLayout(source, isAdmin);
                setPicked(suggested);
                return {
                  ok: true,
                  layout: toLayout(suggested),
                  undo: async () => {
                    setPicked(before);
                    return { ok: true, layout: toLayout(before) };
                  },
                };
              }
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
          {footer(
            <Button
              type="button"
              disabled={!title.trim() || picked.length === 0}
              onClick={() => {
                setError(null);
                setAsking(true);
              }}
            >
              Save report
            </Button>,
            () => go(1),
          )}
          <Dialog
            open={asking}
            onOpenChange={(next) => {
              if (saving) return;
              if (!next && made) router.push(`/app/${orgSlug}/databases/reports/${made.id}`);
              setAsking(next);
            }}
          >
            <DialogContent className="sm:max-w-lg">
              {made ? (
                <>
                  <DialogHeader>
                    <DialogTitle>Saved</DialogTitle>
                    <DialogDescription>
                      Anyone with this link can view it. Copy it now: it shows only once.
                    </DialogDescription>
                  </DialogHeader>
                  <CopyField value={made.link} label="View-only link" />
                  <DialogFooter>
                    <Button
                      type="button"
                      onClick={() => router.push(`/app/${orgSlug}/databases/reports/${made.id}`)}
                    >
                      Open report
                    </Button>
                  </DialogFooter>
                </>
              ) : (
                <>
                  <DialogHeader>
                    <DialogTitle>Save report</DialogTitle>
                    <DialogDescription className="sr-only">
                      Who can see {title.trim() || "this report"}.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-6">
                    <AccessPicker value={access} onSelect={setAccess} disabled={saving} />
                    {access === "ORGANIZATION" ? (
                      <OutsideSharing {...sharing.fields} pending={saving} />
                    ) : (
                      <p className="text-muted-foreground text-[13px]">
                        Pick Organization to share it outside the organization too.
                      </p>
                    )}
                    {error && (
                      <p
                        role="alert"
                        className="bg-tint-danger text-tint-danger-foreground rounded-tile px-3 py-2 text-sm"
                      >
                        {error}
                      </p>
                    )}
                  </div>
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={saving}
                      onClick={() => setAsking(false)}
                    >
                      Cancel
                    </Button>
                    <Button type="button" disabled={saving} onClick={save}>
                      {saving ? "Saving…" : "Save report"}
                    </Button>
                  </DialogFooter>
                </>
              )}
            </DialogContent>
          </Dialog>
        </section>
      )}
    </div>
  );
}
