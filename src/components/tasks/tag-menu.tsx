"use client";

import { Check, Plus, Search } from "@/components/icons";
import { useState, useTransition } from "react";

import { createTag } from "@/app/app/[orgSlug]/settings/labels/actions";
import { cleanTagName, findTag } from "@/lib/tasks/tags";
import { cn } from "@/lib/utils";

import { menuItemClass } from "./task-fields";
import { useTasks } from "./tasks-context";
import type { LabelOption } from "./types";
import { useHashTags } from "./use-hash-tags";

/** Under a title with `#tags` in it: what saving will tag it with. */
export function HashTagHint({ title, className }: { title: string; className?: string }) {
  const { preview } = useHashTags();
  const tags = preview(title);
  if (tags.length === 0) return null;
  return (
    <p
      className={cn("text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs", className)}
      aria-live="polite"
    >
      Tags it
      {tags.map((t) => (
        <span key={t.name} className="text-foreground font-medium">
          #{t.name}
          {t.isNew && <span className="text-muted-foreground font-normal"> (new)</span>}
        </span>
      ))}
    </p>
  );
}

/**
 * The tag picker's menu: type to narrow, click to toggle, Enter to pick the
 * match or make a new tag on the spot ("Create tag “catering”"), which takes
 * the theme's next chart colour. Names are unique regardless of case, so
 * typing "Catering" picks "catering" rather than making a second one.
 */
export function TagMenu({
  value,
  onChange,
  autoFocus = true,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  autoFocus?: boolean;
}) {
  const { org, labels, can, addLabel } = useTasks();
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const typed = cleanTagName(query);
  const needle = typed.toLocaleLowerCase();
  const shown = needle ? labels.filter((l) => l.name.toLocaleLowerCase().includes(needle)) : labels;
  const exact = typed ? findTag(labels, typed) : null;
  const offerCreate = Boolean(typed) && !exact && can.createTags;

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  function create() {
    if (!offerCreate || isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await createTag(org.id, { name: typed });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      addLabel(result.tag);
      if (!value.includes(result.tag.id)) onChange([...value, result.tag.id]);
      setQuery("");
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
            if (exact) {
              toggle(exact.id);
              setQuery("");
            } else if (offerCreate) create();
          }}
          placeholder={can.createTags ? "Add a tag…" : "Find a tag"}
          aria-label="Find or add a tag"
          maxLength={60}
          className="placeholder:text-muted-foreground/80 min-w-0 flex-1 bg-transparent text-[13px] outline-none"
        />
      </div>
      <div
        role="listbox"
        aria-multiselectable="true"
        aria-label="Tags"
        className="flex max-h-64 flex-col gap-px overflow-y-auto"
      >
        {labels.length === 0 && !typed && (
          <p className="text-muted-foreground px-2 py-1.5 text-[13px]">
            {can.createTags ? "No tags yet. Type one to make it." : "No tags yet."}
          </p>
        )}
        {shown.map((l: LabelOption) => {
          const on = value.includes(l.id);
          return (
            <button
              key={l.id}
              type="button"
              role="option"
              aria-selected={on}
              className={menuItemClass(on)}
              onClick={() => toggle(l.id)}
            >
              <span
                aria-hidden="true"
                className="size-[7px] shrink-0 rounded-full"
                style={{ background: l.color }}
              />
              <span className="truncate">{l.name}</span>
              {on && <Check className="ms-auto size-3.5 shrink-0" aria-hidden="true" />}
            </button>
          );
        })}
        {typed && shown.length === 0 && !offerCreate && (
          <p className="text-muted-foreground px-2 py-1.5 text-[13px]">
            {can.createTags ? "No tag by that name." : "Only owners and admins make new tags here."}
          </p>
        )}
        {offerCreate && (
          <button
            type="button"
            className={cn(menuItemClass(), "bg-muted font-semibold")}
            onClick={create}
            disabled={isPending}
          >
            <Plus className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{isPending ? "Creating…" : `Create tag “${typed}”`}</span>
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
