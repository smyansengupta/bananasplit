"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  AlarmClock,
  ArrowUpDown,
  Check,
  Columns3,
  Download,
  Flag,
  FileSpreadsheet,
  Hourglass,
  Table2,
  UserRound,
} from "@/components/icons";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { createDealAction, moveDealAction } from "@/app/app/[orgSlug]/crm/actions";
import { TINT } from "@/components/addons/addon-page";
import { EmptyState } from "@/components/empty-state";
import { PHONE_SMALL_CREATE } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CreateSplitButton } from "@/components/ui/create-split-button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { FieldSelect } from "@/components/ui/field-select";
import { Input } from "@/components/ui/input";
import { SearchField } from "@/components/ui/search-field";
import { chipClass, Segmented } from "@/components/ui/segmented";
import { ExpandChip, FilterPill, FiltersMenu } from "@/components/ui/toolbar-chips";
import { toast } from "@/components/ui/toaster";
import { crmRecordHref } from "@/lib/crm/href";
import { formatMoney, formatMoneyShort } from "@/lib/crm/fields";
import type { EditField } from "@/lib/crm/record-form";
import { hasModifier, isTypingTarget, overlayOpen } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

import { CrmPicker } from "./crm-picker";
import { NeedsDialog } from "./record-fields";
import { useUrlState } from "./use-url";

/**
 * A pipeline (docs/features/crm.md, module 2): its board and its table, on
 * the Tasks bar. Drag a card between stages; a card turns amber when it's
 * been in its stage past the stage's limit, and an open one with no next
 * step is flagged (Pipedrive's rule). Each column shows its count, and its
 * amount where the pipeline has one. Moving to a closing stage asks for a
 * reason in one step, and a stage that needs a field asks for just that.
 */

export interface StageView {
  id: string;
  name: string;
  kind: "OPEN" | "WON" | "LOST";
  stuckAfterDays: number | null;
  requiredFields: string[];
}

export interface CardView {
  id: string;
  title: string;
  stageId: string;
  amountCents: number | null;
  currency: string;
  companyName: string | null;
  personName: string | null;
  nextStep: string | null;
  expectedOn: string | null;
  owner: string | null;
  days: number;
  stuck: boolean;
  closed: boolean;
  sponsorship: boolean;
}

export interface PipelineProps {
  orgId: string;
  orgSlug: string;
  pipeline: {
    id: string;
    name: string;
    itemNoun: string;
    itemNounPlural: string;
    hasAmount: boolean;
    wonLabel: string;
    lostLabel: string;
  };
  stages: StageView[];
  cards: CardView[];
  members: { id: string; name: string }[];
  sortLabels: Record<string, string>;
  /** Editors for the fields a stage can ask for (built-ins and this pipeline's custom fields). */
  stageFields: EditField[];
  tabs: React.ReactNode;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function PipelineView(props: PipelineProps) {
  const { orgId, orgSlug, pipeline, stages } = props;
  const router = useRouter();
  const url = useUrlState();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [cards, setCards] = useState(props.cards);
  const [creating, setCreating] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<{
    card: CardView;
    stage: StageView;
    beforeId: string | null;
    afterId: string | null;
    needs: { keys: string[]; labels: string[] };
    reason?: string;
  } | null>(null);
  const [, start] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  const view = url.get("view") === "table" ? "table" : "board";
  const owner = url.get("owner");
  const flag = url.get("flag");
  const sort = url.get("sort") ?? "board";

  useEffect(() => setCards(props.cards), [props.cards]);

  const startNew = searchParams.get("new") === "1";
  useEffect(() => {
    if (!startNew) return;
    setCreating(stages[0]?.id ?? "");
    const next = new URLSearchParams(searchParams.toString());
    next.delete("new");
    router.replace(next.toString() ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [startNew, searchParams, router, pathname, stages]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || hasModifier(e) || isTypingTarget(e) || overlayOpen()) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "n") {
        e.preventDefault();
        setCreating(stages[0]?.id ?? "");
      } else if (e.key === "1") url.set({ view: undefined });
      else if (e.key === "2") url.set({ view: "table" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stages, url]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));

  const byStage = useMemo(() => {
    const map = new Map<string, CardView[]>(stages.map((s) => [s.id, []]));
    for (const c of cards) map.get(c.stageId)?.push(c);
    return map;
  }, [cards, stages]);

  const doMove = async (
    card: CardView,
    stage: StageView,
    beforeId: string | null,
    afterId: string | null,
    extra: { closeReason?: string | null; fill?: Record<string, unknown> } = {},
  ) => {
    const before = cards;
    setCards((cur) => {
      const rest = cur.filter((c) => c.id !== card.id);
      const moved = { ...card, stageId: stage.id, closed: stage.kind !== "OPEN", stuck: false, days: card.stageId === stage.id ? card.days : 0 };
      const idx = beforeId ? rest.findIndex((c) => c.id === beforeId) : -1;
      if (idx >= 0) rest.splice(idx, 0, moved);
      else rest.push(moved);
      return rest;
    });
    const r = await moveDealAction(orgId, card.id, { stageId: stage.id, beforeId, afterId, ...extra }).catch(() => null);
    if (!r || !r.ok) {
      setCards(before);
      toast({ title: r && !r.ok ? r.error : "That didn't move. Try again.", tone: "error" });
      return;
    }
    if (r.needs) {
      setCards(before);
      setPendingMove({ card, stage, beforeId, afterId, needs: r.needs });
      return;
    }
    start(() => router.refresh());
  };

  const onDragEnd = (e: DragEndEvent) => {
    const card = cards.find((c) => c.id === e.active.id);
    if (!card || !e.over) return;
    const overId = String(e.over.id);
    const stageId = overId.startsWith("stage:") ? overId.slice(6) : cards.find((c) => c.id === overId)?.stageId;
    const stage = stages.find((s) => s.id === stageId);
    if (!stage) return;
    const column = (byStage.get(stage.id) ?? []).filter((c) => c.id !== card.id);
    let beforeId: string | null = null;
    let afterId: string | null = null;
    if (overId.startsWith("stage:")) afterId = column[column.length - 1]?.id ?? null;
    else {
      const i = column.findIndex((c) => c.id === overId);
      beforeId = overId;
      afterId = i > 0 ? column[i - 1]!.id : null;
    }
    if (stage.id === card.stageId && !beforeId && !afterId) return;
    if (stage.kind !== "OPEN" && stage.id !== card.stageId) {
      // The closing stages ask why, in the same step.
      setPendingMove({
        card,
        stage,
        beforeId,
        afterId,
        needs: { keys: stage.requiredFields, labels: stage.requiredFields.map((k) => props.stageFields.find((f) => f.key === k || f.key === `custom.${k}`)?.label ?? k) },
        reason: stage.kind === "WON" ? `What made it ${pipeline.wonLabel.toLowerCase()}? Optional.` : `Why ${pipeline.lostLabel.toLowerCase()}?`,
      });
      return;
    }
    void doMove(card, stage, beforeId, afterId);
  };

  const totalAmount = cards.filter((c) => !c.closed).reduce((n, c) => n + (c.amountCents ?? 0), 0);
  const filterCount = (owner && owner !== "me" ? 1 : 0) + (url.get("sort") ? 1 : 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 max-md:flex-nowrap max-md:items-center">
        <div className="mr-auto min-w-0">
          <h1 className="page-title">{pipeline.name}</h1>
          <p className="text-muted-foreground mt-2 text-[15px] tabular-nums max-md:hidden">
            {cards.filter((c) => !c.closed).length} open {pipeline.itemNounPlural}
            {pipeline.hasAmount && totalAmount > 0 ? `, ${formatMoney(totalAmount)} in play` : ""}
          </p>
        </div>
        <div className={cn("flex flex-wrap items-center gap-2", PHONE_SMALL_CREATE)}>
          <CreateSplitButton
            label={`New ${pipeline.itemNoun}`}
            title={`New ${pipeline.itemNoun} (n)`}
            onClick={() => setCreating(stages[0]?.id ?? "")}
            menuLabel={`More ways to add ${pipeline.itemNounPlural}`}
          >
            <DropdownMenuItem asChild>
              <Link href={`/app/${orgSlug}/crm/import?pipeline=${pipeline.id}`}>
                <FileSpreadsheet className="size-4" aria-hidden="true" />
                Import a file
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={`/app/${orgSlug}/crm/export?kind=items&pipeline=${pipeline.id}`}>
                <Download className="size-4" aria-hidden="true" />
                Export to CSV
              </a>
            </DropdownMenuItem>
          </CreateSplitButton>
        </div>
      </div>
      {props.tabs}
      <div className="@container/toolbar">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Layout"
            value={view}
            onSelect={(v) => url.set({ view: v === "board" ? undefined : v })}
            options={[
              { value: "board", label: "Board", icon: Columns3, compact: true, title: "Board (1)" },
              { value: "table", label: "Table", icon: Table2, compact: true, title: "Table (2)" },
            ]}
          />
          <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Show">
            <ExpandChip icon={UserRound} label="Mine" active={owner === "me"} onClick={() => url.set({ owner: owner === "me" ? undefined : "me" })} />
            <ExpandChip icon={Hourglass} label="Stuck" active={flag === "stuck"} onClick={() => url.set({ flag: flag === "stuck" ? undefined : "stuck" })} />
            <ExpandChip icon={Flag} label="No next step" active={flag === "nostep"} onClick={() => url.set({ flag: flag === "nostep" ? undefined : "nostep" })} />
            <ExpandChip icon={AlarmClock} label="Closed too" active={url.get("closed") === "1"} onClick={() => url.set({ closed: url.get("closed") === "1" ? undefined : "1" })} />
          </div>
          <FiltersMenu
            count={filterCount}
            items={[
              {
                name: "Owner",
                node: (
                  <FieldSelect value={owner ?? ""} onChange={(e) => url.set({ owner: e.target.value || undefined })} aria-label="Owner">
                    <option value="">Anyone</option>
                    <option value="me">Me or my role</option>
                    <option value="none">Nobody</option>
                    {props.members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </FieldSelect>
                ),
              },
              {
                name: "Sort",
                node: (
                  <div className="flex flex-col gap-px">
                    {Object.entries(props.sortLabels).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => url.set({ sort: key === "board" ? undefined : key })}
                        className="hover:bg-muted flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm"
                      >
                        <ArrowUpDown className="size-3.5 opacity-60" aria-hidden="true" />
                        <span className="flex-1">{label}</span>
                        {sort === key && <Check className="size-3.5" aria-hidden="true" />}
                      </button>
                    ))}
                  </div>
                ),
              },
            ]}
          />
          <div className="ms-auto flex min-w-48 flex-1 items-center justify-end">
            <SearchField
              key={url.get("q") ?? ""}
              ref={searchRef}
              defaultValue={url.get("q") ?? ""}
              hint="/"
              placeholder={`Search ${pipeline.itemNounPlural}`}
              aria-label={`Search ${pipeline.itemNounPlural}`}
              onKeyDown={(e) => {
                if (e.key === "Enter") url.set({ q: (e.target as HTMLInputElement).value.trim() || undefined });
              }}
              onClear={() => url.set({ q: undefined })}
            />
          </div>
        </div>
      </div>
      {((owner && owner !== "me") || url.get("q")) && (
        <div className="flex flex-wrap gap-1.5">
          {owner && owner !== "me" && (
            <FilterPill label={owner === "none" ? "Nobody owns" : `Owned by ${props.members.find((m) => m.id === owner)?.name ?? "someone"}`} onClear={() => url.set({ owner: undefined })} />
          )}
          {url.get("q") && <FilterPill label={`“${url.get("q")}”`} onClear={() => url.set({ q: undefined })} />}
        </div>
      )}

      {view === "board" ? (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
          <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-3">
            {stages.map((s) => {
              const list = byStage.get(s.id) ?? [];
              const amount = list.reduce((n, c) => n + (c.amountCents ?? 0), 0);
              return (
                <Column key={s.id} stage={s} count={list.length} amount={pipeline.hasAmount ? amount : null} onAdd={() => setCreating(s.id)} noun={pipeline.itemNoun}>
                  {list.map((c) => (
                    <Card key={c.id} card={c} orgSlug={orgSlug} />
                  ))}
                </Column>
              );
            })}
          </div>
        </DndContext>
      ) : cards.length === 0 ? (
        <EmptyState icon={Columns3} title={`No ${pipeline.itemNounPlural} yet`} />
      ) : (
        <div className="bg-card ring-foreground/6 rounded-card overflow-x-auto ring-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-border border-b text-left text-xs">
                <th className="px-3 py-2.5 font-semibold">Title</th>
                <th className="px-2 py-2.5 font-semibold">Stage</th>
                {pipeline.hasAmount && <th className="px-2 py-2.5 text-right font-semibold">Amount</th>}
                <th className="px-2 py-2.5 font-semibold max-md:hidden">Company</th>
                <th className="px-2 py-2.5 font-semibold max-lg:hidden">Owner</th>
                <th className="px-2 py-2.5 font-semibold max-md:hidden">Next step</th>
                <th className="px-3 py-2.5 font-semibold max-sm:hidden">Expected</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.id} className={cn("border-border/60 border-b last:border-0", c.stuck && TINT.amber)}>
                  <td className="px-3 py-2">
                    <Link href={crmRecordHref(orgSlug, "deal", c.id)} className="font-semibold hover:underline">
                      {c.title}
                    </Link>
                  </td>
                  <td className="px-2 py-2">
                    <FieldSelect
                      value={c.stageId}
                      aria-label={`Stage of ${c.title}`}
                      className="h-8 w-40"
                      onChange={(e) => {
                        const stage = stages.find((s) => s.id === e.target.value);
                        if (!stage) return;
                        if (stage.kind !== "OPEN") {
                          setPendingMove({
                            card: c,
                            stage,
                            beforeId: null,
                            afterId: null,
                            needs: { keys: stage.requiredFields, labels: stage.requiredFields },
                            reason: stage.kind === "WON" ? "What made it happen? Optional." : "Why did it close?",
                          });
                          return;
                        }
                        void doMove(c, stage, null, null);
                      }}
                    >
                      {stages.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </FieldSelect>
                  </td>
                  {pipeline.hasAmount && <td className="px-2 py-2 text-right tabular-nums">{formatMoney(c.amountCents, c.currency)}</td>}
                  <td className="text-muted-foreground px-2 py-2 max-md:hidden">{c.companyName}</td>
                  <td className="text-muted-foreground px-2 py-2 max-lg:hidden">{c.owner}</td>
                  <td className="px-2 py-2 max-md:hidden">
                    {c.nextStep ? (
                      <span className="text-muted-foreground">{c.nextStep}</span>
                    ) : !c.closed ? (
                      <Badge variant="destructive">No next step</Badge>
                    ) : null}
                  </td>
                  <td className="text-muted-foreground px-3 py-2 max-sm:hidden">
                    {c.expectedOn ? new Date(c.expectedOn).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pendingMove && (
        <NeedsDialog
          title={`Move to ${pendingMove.stage.name}`}
          needs={pendingMove.needs}
          fields={props.stageFields}
          orgId={orgId}
          reasonPrompt={pendingMove.reason}
          onCancel={() => setPendingMove(null)}
          onSubmit={async (fill) => {
            const { closeReason, ...rest } = fill;
            const m = pendingMove;
            setPendingMove(null);
            await doMove(m.card, m.stage, m.beforeId, m.afterId, {
              closeReason: (closeReason as string) ?? null,
              fill: Object.keys(rest).length ? rest : undefined,
            });
          }}
        />
      )}
      {creating !== null && (
        <NewItemDialog
          orgId={orgId}
          pipeline={pipeline}
          stages={stages.filter((s) => s.kind === "OPEN")}
          stageId={creating || stages[0]?.id || ""}
          onClose={() => setCreating(null)}
          onCreated={() => {
            setCreating(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function Column({
  stage,
  count,
  amount,
  children,
  onAdd,
  noun,
}: {
  stage: StageView;
  count: number;
  amount: number | null;
  children: React.ReactNode;
  onAdd: () => void;
  noun: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage:${stage.id}` });
  return (
    <section
      ref={setNodeRef}
      aria-label={stage.name}
      className={cn(
        "bg-muted/45 flex w-72 shrink-0 flex-col gap-2 rounded-2xl p-2 transition-colors",
        isOver && "bg-muted",
        stage.kind === "WON" && "bg-tint-success/40",
        stage.kind === "LOST" && "bg-tint-danger/25",
      )}
    >
      <header className="flex items-center gap-2 px-2 pt-1">
        <b className="min-w-0 flex-1 truncate text-sm">{stage.name}</b>
        <span className="bg-foreground/10 text-foreground/70 grid h-[18px] min-w-[18px] place-items-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums">
          {count}
        </span>
        {amount !== null && amount > 0 && <span className="text-muted-foreground text-xs tabular-nums">{formatMoneyShort(amount)}</span>}
      </header>
      <div className="flex min-h-16 flex-col gap-2">{children}</div>
      {stage.kind === "OPEN" && (
        <button type="button" onClick={onAdd} className="text-muted-foreground hover:bg-background/70 rounded-xl px-2 py-1.5 text-left text-[13px]">
          + Add {noun}
        </button>
      )}
    </section>
  );
}

function Card({ card, orgSlug }: { card: CardView; orgSlug: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.id });
  const { setNodeRef: dropRef } = useDroppable({ id: card.id });
  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        dropRef(el);
      }}
      {...attributes}
      {...listeners}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={cn(
        "bg-card ring-foreground/8 cursor-grab rounded-xl p-3 text-sm shadow-xs ring-1 active:cursor-grabbing",
        card.stuck && TINT.amber,
        isDragging && "z-10 opacity-80 shadow-lg",
      )}
    >
      <Link href={crmRecordHref(orgSlug, "deal", card.id)} className="block font-semibold hover:underline" onPointerDown={(e) => e.stopPropagation()}>
        {card.title}
      </Link>
      {(card.companyName || card.personName) && (
        <p className="text-muted-foreground mt-0.5 truncate text-xs">{[card.companyName, card.personName].filter(Boolean).join(", ")}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        {card.amountCents !== null && <b className="tabular-nums">{formatMoney(card.amountCents, card.currency)}</b>}
        {card.stuck && <span className="font-semibold">{card.days} days here</span>}
        {!card.closed && !card.nextStep && (
          <span className="text-tint-danger-foreground inline-flex items-center gap-1 font-semibold">
            <Flag className="size-3" aria-hidden="true" />
            No next step
          </span>
        )}
        {card.sponsorship && <Badge variant="outline">Finance</Badge>}
      </div>
      {card.nextStep && <p className="text-muted-foreground mt-1.5 line-clamp-2 text-xs">Next: {card.nextStep}</p>}
    </div>
  );
}

function NewItemDialog({
  orgId,
  pipeline,
  stages,
  stageId,
  onClose,
  onCreated,
}: {
  orgId: string;
  pipeline: PipelineProps["pipeline"];
  stages: StageView[];
  stageId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [stage, setStage] = useState(stageId);
  const [company, setCompany] = useState<{ id: string; label: string } | null>(null);
  const [person, setPerson] = useState<{ id: string; label: string } | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New {pipeline.itemNoun}</DialogTitle>
          <DialogDescription>A title is enough; add the rest on its page.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            setPending(true);
            const r = await createDealAction(orgId, {
              pipelineId: pipeline.id,
              stageId: stage,
              title: String(data.get("title") ?? ""),
              amount: pipeline.hasAmount ? String(data.get("amount") ?? "") || null : null,
              nextStep: String(data.get("nextStep") ?? "") || null,
              companyId: company?.id ?? null,
              primaryPersonId: person?.id ?? null,
            }).catch(() => null);
            setPending(false);
            if (!r || !r.ok) {
              toast({ title: r && !r.ok ? r.error : "That didn't work.", tone: "error" });
              return;
            }
            toast({ title: `${cap(pipeline.itemNoun)} added.` });
            onCreated();
          }}
        >
          <label className="grid gap-1.5 text-sm">
            <span className="text-muted-foreground">Title</span>
            <Input name="title" autoFocus />
          </label>
          <div className="grid gap-1.5 text-sm">
            <span className="text-muted-foreground">Stage</span>
            <div className="flex flex-wrap gap-1.5">
              {stages.map((s) => (
                <button key={s.id} type="button" aria-pressed={stage === s.id} onClick={() => setStage(s.id)} className={cn(chipClass(stage === s.id), "h-8 px-3 text-[13px]")}>
                  {s.name}
                </button>
              ))}
            </div>
          </div>
          {pipeline.hasAmount && (
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">Amount</span>
              <Input name="amount" inputMode="decimal" placeholder="$0" />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <CrmPicker orgId={orgId} kind="company" value={company?.id ?? null} display={company?.label} placeholder="Company" onPick={(h) => setCompany(h ? { id: h.id, label: h.label } : null)} />
            <CrmPicker orgId={orgId} kind="person" value={person?.id ?? null} display={person?.label} placeholder="Person" onPick={(h) => setPerson(h ? { id: h.id, label: h.label } : null)} />
          </div>
          <label className="grid gap-1.5 text-sm">
            <span className="text-muted-foreground">Next step</span>
            <Input name="nextStep" placeholder="Send the deck by Friday" />
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
