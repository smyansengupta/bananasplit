"use client";

import { Check, Layers, Plus, Search } from "@/components/icons";
import { useState, useTransition } from "react";

import { createTask } from "@/app/app/[orgSlug]/tasks/actions";
import { epicColor } from "@/lib/tasks/epic";
import { cn } from "@/lib/utils";

import { menuItemClass } from "./task-fields";
import { TaskTypeChip } from "./task-type";
import { useTasks } from "./tasks-context";
import type { ParentOption } from "./types";

/**
 * What a task is part of: the epic picker (the toolbar's Epic filter, the
 * board's lanes) and, with stories too, the editor's "Part of" field. Type
 * to narrow, pick one, or make an epic on the spot ("Create epic “Spring
 * Gala”"). Stories show under their epic's name, so two "Logistics"
 * stories stay apart.
 */
export function ParentMenu({
  value,
  onPick,
  types = ["EPIC"],
  noneLabel = "No epic",
  showNone = true,
  autoFocus = true,
  excludeId,
}: {
  value: string | null;
  onPick: (id: string | null) => void;
  /** Which kinds may be picked: epics, or epics and stories. */
  types?: readonly ("EPIC" | "STORY")[];
  noneLabel?: string;
  showNone?: boolean;
  autoFocus?: boolean;
  /** The task being edited (it can't be its own parent). */
  excludeId?: string;
}) {
  const { org, parents, parentById, addParent, announce } = useTasks();
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const typed = query.trim();
  const needle = typed.toLowerCase();
  // Each epic, then its own stories under it; stories outside one last.
  const allowed = parents.filter(
    (p) => types.includes(p.type as "EPIC" | "STORY") && p.id !== excludeId,
  );
  const storiesOf = (epicId: string | null) =>
    allowed.filter((p) => p.type === "STORY" && p.parentTaskId === epicId);
  const options = [
    ...allowed.filter((p) => p.type === "EPIC").flatMap((e) => [e, ...storiesOf(e.id)]),
    ...allowed.filter(
      (p) =>
        p.type === "STORY" && !allowed.some((e) => e.type === "EPIC" && e.id === p.parentTaskId),
    ),
  ];
  const labelOf = (p: ParentOption) => {
    const epic = p.parentTaskId ? parentById.get(p.parentTaskId) : undefined;
    return epic ? `${epic.title} / ${p.title}` : p.title;
  };
  const shown = needle ? options.filter((p) => labelOf(p).toLowerCase().includes(needle)) : options;
  const exact = options.find((p) => p.type === "EPIC" && p.title.toLowerCase() === needle);
  const offerCreate = Boolean(typed) && !exact && types.includes("EPIC");

  function create() {
    if (!offerCreate || isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await createTask(org.id, { title: typed, type: "EPIC" });
      if (!("taskId" in result) || !result.taskId) {
        setError(result.error ?? "That epic couldn't be made.");
        return;
      }
      const taskId = result.taskId;
      addParent({
        id: taskId,
        title: typed,
        type: "EPIC",
        color: null,
        status: "NOT_STARTED",
        ownerId: null,
        startDate: null,
        dueDate: null,
        visibility: "ORG",
        parentTaskId: null,
      });
      announce(`Created epic “${typed}”`);
      onPick(taskId);
    });
  }

  return (
    <div className="flex flex-col gap-px">
      <div className="bg-muted/60 mb-1 flex h-9 items-center gap-2 rounded-full px-3">
        <Search className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
        <input
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (exact) onPick(exact.id);
            else if (offerCreate) create();
            else if (shown.length === 1) onPick(shown[0]!.id);
          }}
          placeholder={types.includes("EPIC") ? "Find or create an epic" : "Find a story"}
          aria-label="Find an epic"
          maxLength={200}
          className="placeholder:text-muted-foreground/80 min-w-0 flex-1 bg-transparent text-[13px] outline-none"
        />
      </div>
      <div
        role="listbox"
        aria-label="Part of"
        className="flex max-h-64 flex-col gap-px overflow-y-auto"
      >
        {showNone && !needle && (
          <button
            type="button"
            role="option"
            aria-selected={!value}
            className={menuItemClass(!value)}
            onClick={() => onPick(null)}
          >
            <EpicDot epic={null} />
            {noneLabel}
            {!value && <Check className="ms-auto size-3.5" aria-hidden="true" />}
          </button>
        )}
        {shown.map((p) => {
          const epic =
            p.type === "EPIC" ? p : p.parentTaskId ? parentById.get(p.parentTaskId) : null;
          return (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={p.id === value}
              className={cn(menuItemClass(p.id === value), p.type === "STORY" && epic && "ps-6")}
              onClick={() => onPick(p.id)}
            >
              {p.type === "EPIC" ? <EpicDot epic={p} /> : <TaskTypeChip type="STORY" iconOnly />}
              <span className={cn("truncate", p.status === "COMPLETED" && "text-muted-foreground")}>
                {p.type === "STORY" && epic ? (
                  <>
                    <span className="text-muted-foreground">{epic.title} / </span>
                    {p.title}
                  </>
                ) : (
                  p.title
                )}
              </span>
              {p.id === value && <Check className="ms-auto size-3.5" aria-hidden="true" />}
            </button>
          );
        })}
        {options.length === 0 && !typed && (
          <p className="text-muted-foreground flex items-center gap-2 px-2 py-1.5 text-[13px]">
            <Layers className="size-3.5" aria-hidden="true" />
            No epics yet. Type a name to make one.
          </p>
        )}
        {typed && shown.length === 0 && !offerCreate && (
          <p className="text-muted-foreground px-2 py-1.5 text-[13px]">Nothing by that name.</p>
        )}
        {offerCreate && (
          <button
            type="button"
            className={cn(menuItemClass(), "bg-muted font-semibold")}
            onClick={create}
            disabled={isPending}
          >
            <Plus className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{isPending ? "Creating…" : `Create epic “${typed}”`}</span>
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-destructive px-2 py-1 text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

/** The 8px dot with a soft halo (StatusDot's mark), in the epic's colour. */
export function EpicDot({
  epic,
}: {
  epic: { id: string; color?: string | null } | null | undefined;
}) {
  const color = epicColor(epic);
  return (
    <span
      aria-hidden="true"
      className="size-2 shrink-0 rounded-full"
      style={{
        background: color,
        boxShadow: `0 0 0 3px color-mix(in oklab, ${color} 24%, transparent)`,
      }}
    />
  );
}
