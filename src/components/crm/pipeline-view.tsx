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
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { moveDealAction } from "@/app/app/[orgSlug]/crm/actions";
import { useCrmOpen } from "@/components/crm/card/use-crm-open";
import { toast } from "@/components/ui/toaster";
import { stageTone } from "@/lib/crm/deals-tab";
import { formatMoney, formatMoneyShort } from "@/lib/crm/fields";
import type { EditField } from "@/lib/crm/record-form";
import { CHOICE_COLOR_CLASS, type ChoiceColor } from "@/lib/databases/fields";
import { cn } from "@/lib/utils";

import { NeedsDialog } from "./record-fields";

/**
 * One pipeline as a board, on the Deals tab (?view=board): a column per
 * stage with its dot, count and amount, a card per deal (its type, name and
 * amount) that opens the deal's card over the page. Drag a card to another
 * stage; a closing stage asks why in the same step, and a stage that needs a
 * field asks for just that. A card past its stage's limit is tinted.
 */

export interface StageView {
  id: string;
  name: string;
  kind: "OPEN" | "WON" | "LOST";
  requiredFields: string[];
}

export interface BoardCard {
  id: string;
  title: string;
  stageId: string;
  amountCents: number | null;
  currency: string;
  companyName: string | null;
  type: { label: string; color: ChoiceColor } | null;
  stuck: boolean;
  days: number;
}

export function DealBoard({
  orgId,
  pipeline,
  stages,
  cards: initial,
  stageFields,
}: {
  orgId: string;
  pipeline: { hasAmount: boolean; wonLabel: string; lostLabel: string };
  stages: StageView[];
  cards: BoardCard[];
  /** Editors for the fields a stage can ask for (built-ins and the pipeline's custom fields). */
  stageFields: EditField[];
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [cards, setCards] = useState(initial);
  // A refresh brings the server's cards.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setCards(initial);
  }
  const [pending, setPending] = useState<{
    card: BoardCard;
    stage: StageView;
    beforeId: string | null;
    afterId: string | null;
    needs: { keys: string[]; labels: string[] };
    reason?: string;
  } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const byStage = useMemo(() => {
    const map = new Map<string, BoardCard[]>(stages.map((s) => [s.id, []]));
    for (const c of cards) map.get(c.stageId)?.push(c);
    return map;
  }, [cards, stages]);

  const labelOf = (k: string) =>
    stageFields.find((f) => f.key === k || f.key === `custom.${k}`)?.label ?? k;

  const doMove = async (
    card: BoardCard,
    stage: StageView,
    beforeId: string | null,
    afterId: string | null,
    extra: { closeReason?: string | null; fill?: Record<string, unknown> } = {},
  ) => {
    const before = cards;
    const from = card.stageId;
    setCards((cur) => {
      const rest = cur.filter((c) => c.id !== card.id);
      const moved = { ...card, stageId: stage.id, stuck: false };
      const idx = beforeId ? rest.findIndex((c) => c.id === beforeId) : -1;
      if (idx >= 0) rest.splice(idx, 0, moved);
      else rest.push(moved);
      return rest;
    });
    const r = await moveDealAction(orgId, card.id, { stageId: stage.id, beforeId, afterId, ...extra }).catch(
      () => null,
    );
    if (!r || !r.ok) {
      setCards(before);
      toast({ title: r && !r.ok ? r.error : "That didn't move. Try again.", tone: "error" });
      return;
    }
    if (r.needs) {
      setCards(before);
      setPending({ card, stage, beforeId, afterId, needs: r.needs });
      return;
    }
    if (from !== stage.id) {
      toast({
        title: `${card.title} moved to ${stage.name}.`,
        action: {
          label: "Undo",
          run: async () => {
            const u = await moveDealAction(orgId, card.id, { stageId: from }).catch(() => null);
            if (!u || !u.ok || u.needs) toast({ title: "It couldn't go back. Move it by hand.", tone: "error" });
            start(() => router.refresh());
          },
        },
      });
    }
    start(() => router.refresh());
  };

  const onDragEnd = (e: DragEndEvent) => {
    const card = cards.find((c) => c.id === e.active.id);
    if (!card || !e.over) return;
    const overId = String(e.over.id);
    const stageId = overId.startsWith("stage:")
      ? overId.slice(6)
      : cards.find((c) => c.id === overId)?.stageId;
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
      setPending({
        card,
        stage,
        beforeId,
        afterId,
        needs: { keys: stage.requiredFields, labels: stage.requiredFields.map(labelOf) },
        reason:
          stage.kind === "WON"
            ? `What made it ${pipeline.wonLabel.toLowerCase()}? Optional.`
            : `Why ${pipeline.lostLabel.toLowerCase()}?`,
      });
      return;
    }
    void doMove(card, stage, beforeId, afterId);
  };

  let open = 0;
  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
        <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-3">
          {stages.map((s) => {
            const list = byStage.get(s.id) ?? [];
            const amount = list.reduce((n, c) => n + (c.amountCents ?? 0), 0);
            const tone = stageTone(s.kind, s.kind === "OPEN" ? open++ : 0);
            return (
              <Column
                key={s.id}
                stage={s}
                tone={tone}
                count={list.length}
                amount={pipeline.hasAmount ? amount : null}
              >
                {list.map((c) => (
                  <Card key={c.id} card={c} />
                ))}
              </Column>
            );
          })}
        </div>
      </DndContext>
      {pending && (
        <NeedsDialog
          title={`Move to ${pending.stage.name}`}
          needs={pending.needs}
          fields={stageFields}
          orgId={orgId}
          reasonPrompt={pending.reason}
          onCancel={() => setPending(null)}
          onSubmit={async (fill) => {
            const { closeReason, ...rest } = fill;
            const m = pending;
            setPending(null);
            await doMove(m.card, m.stage, m.beforeId, m.afterId, {
              closeReason: (closeReason as string) ?? null,
              fill: Object.keys(rest).length ? rest : undefined,
            });
          }}
        />
      )}
    </>
  );
}

function Column({
  stage,
  tone,
  count,
  amount,
  children,
}: {
  stage: StageView;
  tone: string;
  count: number;
  amount: number | null;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage:${stage.id}` });
  return (
    <section
      ref={setNodeRef}
      aria-label={stage.name}
      className={cn(
        "bg-muted/45 flex w-72 shrink-0 flex-col gap-2 rounded-[22px] p-2.5 transition-colors",
        isOver && "bg-muted",
      )}
    >
      <header className="flex items-center gap-2 px-2 pt-1.5 pb-0.5">
        <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: tone }} />
        <b className="min-w-0 flex-1 truncate text-[15px]">{stage.name}</b>
        <span className="bg-background grid h-6 min-w-6 place-items-center rounded-full px-2 text-xs font-semibold tabular-nums">
          {count}
        </span>
        {amount !== null && amount > 0 && (
          <span className="text-muted-foreground text-xs tabular-nums">{formatMoneyShort(amount)}</span>
        )}
      </header>
      <div className="flex min-h-16 flex-col gap-2">{children}</div>
    </section>
  );
}

function Card({ card }: { card: BoardCard }) {
  const { hrefFor } = useCrmOpen();
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
        "bg-card ring-foreground/6 flex cursor-grab flex-col gap-2 rounded-2xl p-3.5 text-sm ring-1 active:cursor-grabbing",
        card.stuck && "bg-[color-mix(in_oklab,var(--attention)_10%,var(--card))]",
        isDragging && "z-10 opacity-80 shadow-lg",
      )}
    >
      {card.type && <TypeTag label={card.type.label} color={card.type.color} />}
      <Link
        href={hrefFor({ kind: "deal", id: card.id })}
        scroll={false}
        className="text-[15px] leading-snug font-semibold hover:underline"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {card.title}
      </Link>
      <div className="text-muted-foreground flex items-center gap-2 text-[13px]">
        {card.amountCents !== null && (
          <b className="text-foreground tabular-nums">{formatMoney(card.amountCents, card.currency)}</b>
        )}
        {card.companyName && <span className="min-w-0 truncate">{card.companyName}</span>}
        {card.stuck && <span className="ms-auto shrink-0">{card.days} days here</span>}
      </div>
    </div>
  );
}

/** A deal's type as a small tag, in its choice's colour. */
export function TypeTag({ label, color, className }: { label: string; color: ChoiceColor; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 w-fit shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold",
        CHOICE_COLOR_CLASS[color],
        className,
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}
