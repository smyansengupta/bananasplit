"use client";

import {
  DndContext,
  DragOverlay,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { UserAvatar } from "@/components/user-avatar";
import { canDrop, toTree, type DraftPosition, type DropZone } from "@/lib/org-chart/draft";
import { indexChart } from "@/lib/org-chart/tree";
import { cn } from "@/lib/utils";

import type { EditorMember } from "./member-picker";

/**
 * The draft's outline: one row per position, indented by reporting line,
 * advisors listed first under their manager. Drag a row by its handle
 * (mouse, or touch and hold) and drop it ON another row to report to it,
 * or on the upper or lower edge of a row to sit before or after it. The
 * position editor's "Reports to" picker and move buttons do the same from
 * the keyboard.
 */

interface Row {
  position: DraftPosition;
  depth: number;
}

export function flattenOutline(positions: readonly DraftPosition[]): Row[] {
  const byId = new Map(positions.map((p) => [p.id, p]));
  const index = indexChart(toTree(positions));
  const rows: Row[] = [];
  const seen = new Set<string>();
  const walk = (id: string, depth: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    rows.push({ position: byId.get(id) as DraftPosition, depth });
    for (const a of index.advisorsOf(id)) walk(a.id, depth + 1);
    for (const r of index.reportsOf(id)) walk(r.id, depth + 1);
  };
  for (const root of index.roots) walk(root.id, 0);
  // Anything unreachable (should not happen) is still listed.
  for (const p of positions) if (!seen.has(p.id)) walk(p.id, 0);
  return rows;
}

function pointerY(event: DragMoveEvent | DragEndEvent): number | null {
  const start = event.activatorEvent;
  let y: number | null = null;
  if (typeof MouseEvent !== "undefined" && start instanceof MouseEvent) y = start.clientY;
  else if (typeof TouchEvent !== "undefined" && start instanceof TouchEvent) y = start.touches[0]?.clientY ?? null;
  return y === null ? null : y + event.delta.y;
}

function zoneFor(event: DragMoveEvent | DragEndEvent): DropZone | null {
  const over = event.over;
  const y = pointerY(event);
  if (!over || y === null) return null;
  const { top, height } = over.rect;
  if (y < top + height * 0.28) return "before";
  if (y > top + height * 0.72) return "after";
  return "inside";
}

export function OutlineTree({
  positions,
  members,
  selectedId,
  onSelect,
  onMove,
  issuesById,
}: {
  positions: DraftPosition[];
  members: ReadonlyMap<string, EditorMember>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (dragId: string, targetId: string, zone: DropZone) => void;
  issuesById: ReadonlyMap<string, "error" | "warning">;
}) {
  const rows = useMemo(() => flattenOutline(positions), [positions]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ overId: string; zone: DropZone } | null>(null);
  const lastDrop = useRef<string>("");
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  const onDragStart = (e: DragStartEvent) => setDragId(String(e.active.id));
  const onDragMove = (e: DragMoveEvent) => {
    const zone = zoneFor(e);
    const overId = e.over ? String(e.over.id) : null;
    const valid = overId && zone && canDrop(positions, String(e.active.id), overId, zone);
    const sig = valid ? `${overId}:${zone}` : "";
    if (sig === lastDrop.current) return;
    lastDrop.current = sig;
    setDrop(valid ? { overId: overId as string, zone: zone as DropZone } : null);
  };
  const onDragEnd = (e: DragEndEvent) => {
    const zone = zoneFor(e);
    const overId = e.over ? String(e.over.id) : null;
    const activeId = String(e.active.id);
    setDragId(null);
    setDrop(null);
    lastDrop.current = "";
    if (overId && zone && canDrop(positions, activeId, overId, zone)) onMove(activeId, overId, zone);
  };
  const onDragCancel = () => {
    setDragId(null);
    setDrop(null);
    lastDrop.current = "";
  };

  const dragged = dragId ? positions.find((p) => p.id === dragId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "Drag handles work with a mouse or touch. From the keyboard, select the position and use Reports to and the move buttons in the editor.",
        },
      }}
    >
      <ul aria-label="Positions in this draft" className="space-y-0.5">
        {rows.map(({ position, depth }) => (
          <OutlineRow
            key={position.id}
            position={position}
            depth={depth}
            member={position.userId ? (members.get(position.userId) ?? null) : null}
            selected={position.id === selectedId}
            dragging={position.id === dragId}
            drop={drop?.overId === position.id ? drop.zone : null}
            issue={issuesById.get(position.id) ?? null}
            onSelect={onSelect}
          />
        ))}
      </ul>
      <DragOverlay dropAnimation={null}>
        {dragged ? (
          <div className="bg-popover text-popover-foreground rounded-md border px-3 py-2 text-sm font-medium shadow-lg">
            {dragged.title || "Untitled"}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function OutlineRow({
  position,
  depth,
  member,
  selected,
  dragging,
  drop,
  issue,
  onSelect,
}: {
  position: DraftPosition;
  depth: number;
  member: EditorMember | null;
  selected: boolean;
  dragging: boolean;
  drop: DropZone | null;
  issue: "error" | "warning" | null;
  onSelect: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef: setDragRef } = useDraggable({ id: position.id });
  const { setNodeRef: setDropRef } = useDroppable({ id: position.id });
  const person = position.isOpen
    ? "Open hire"
    : (member?.name ?? position.personName ?? "Unfilled");

  return (
    <li
      ref={setDropRef}
      style={{ paddingLeft: depth * 20 }}
      className={cn("relative", dragging && "opacity-40")}
    >
      {drop === "before" && <span aria-hidden="true" className="bg-primary absolute inset-x-0 top-0 h-0.5 rounded" />}
      {drop === "after" && <span aria-hidden="true" className="bg-primary absolute inset-x-0 bottom-0 h-0.5 rounded" />}
      <div
        className={cn(
          "flex items-center gap-1 rounded-md border border-transparent",
          selected && "bg-muted border-border",
          drop === "inside" && "border-primary bg-primary/10",
        )}
      >
        <button
          type="button"
          ref={setDragRef}
          {...listeners}
          {...attributes}
          aria-label={`Drag ${position.title || "position"}`}
          className="text-muted-foreground hover:text-foreground flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded active:cursor-grabbing"
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onSelect(position.id)}
          aria-current={selected ? "true" : undefined}
          className="focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pr-2 text-left outline-none focus-visible:ring-2"
        >
          {member ? (
            <UserAvatar user={member} size="sm" />
          ) : (
            <span aria-hidden="true" className="bg-muted size-6 shrink-0 rounded-full border border-dashed" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{position.title || "Untitled position"}</span>
            <span className="text-muted-foreground block truncate text-xs">
              {person}
              {position.isAdvisor && " · Advisor"}
              {!position.isOpen && !position.userId && position.matchState === "SUGGESTED" && " · Confirm match"}
            </span>
          </span>
          {issue && (
            <span
              className={cn("size-2 shrink-0 rounded-full", issue === "error" ? "bg-destructive" : "bg-amber-500")}
              aria-label={issue === "error" ? "Has a problem" : "Has a warning"}
              role="img"
            />
          )}
        </button>
      </div>
    </li>
  );
}
