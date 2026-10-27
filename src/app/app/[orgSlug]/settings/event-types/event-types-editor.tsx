"use client";

import { ArrowDown, ArrowUp, Check, Plus, Trash2 } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  MAX_TAG_NAME,
  MAX_TAGS_PER_ORG,
  TAG_COLOR_LABELS,
  TAG_COLORS,
  tagColorOf,
  tagToken,
  type EventTagOption,
} from "@/lib/calendar/tags";
import { cn } from "@/lib/utils";

import { createEventTag, deleteEventTag, moveEventTag, updateEventTag } from "./actions";

/**
 * Settings › Event types: the words this organization uses for what goes on
 * its calendar. The list is the order the calendar's filter row draws them
 * in, so moving one here moves it there.
 *
 * Deleting a type never deletes its events: they keep their place with no
 * type, and the dialog says how many that is before anyone agrees to it.
 */
export function EventTypesEditor({ orgId, tags }: { orgId: string; tags: EventTagOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmEl, confirm] = useConfirm();
  const [adding, setAdding] = useState("");

  const run = (action: () => Promise<{ error?: string } | { ok: true }>, done?: string) =>
    start(async () => {
      const result = await action();
      if ("error" in result && result.error) {
        toast({ title: result.error, tone: "error" });
        return;
      }
      if (done) toast({ title: done, tone: "success" });
      router.refresh();
    });

  const add = () => {
    const name = adding.trim();
    if (!name) return;
    // The next colour along, so a new type is never the same as the last.
    const color = TAG_COLORS[tags.length % TAG_COLORS.length]!;
    run(async () => {
      const result = await createEventTag(orgId, { name, color });
      if (!("error" in result) || !result.error) setAdding("");
      return result;
    }, `Added ${name}`);
  };

  const full = tags.length >= MAX_TAGS_PER_ORG;

  return (
    <div className="space-y-4">
      {tags.length === 0 ? (
        <div className="bg-card edge rounded-card">
          <EmptyState
            icon={Plus}
            title="No event types yet"
            description="A type is the organization's own word for what an event is — a meeting, a rehearsal, a deadline. The calendar colours and filters by them."
          />
        </div>
      ) : (
        <ul className="bg-card edge rounded-card divide-border divide-y">
          {tags.map((tag, i) => (
            <li key={tag.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span
                aria-hidden="true"
                className="size-3 shrink-0 rounded-full"
                style={{ background: `var(${tagToken(tag.color)})` }}
              />
              <NameField
                tag={tag}
                disabled={pending}
                onSave={(name) =>
                  run(() => updateEventTag(orgId, { id: tag.id, name }), `Renamed to ${name}`)
                }
              />
              <span className="flex shrink-0 items-center gap-1.5">
                {[null, ...TAG_COLORS].map((c) => (
                  <button
                    key={c ?? "none"}
                    type="button"
                    disabled={pending}
                    aria-label={c ? TAG_COLOR_LABELS[c] : "No colour"}
                    title={c ? TAG_COLOR_LABELS[c] : "No colour"}
                    aria-pressed={tagColorOf(tag.color) === c}
                    onClick={() => run(() => updateEventTag(orgId, { id: tag.id, color: c }))}
                    className="focus-glow grid size-5 place-items-center rounded-md border disabled:opacity-50"
                    style={{ background: `var(${tagToken(c)})` }}
                  >
                    {tagColorOf(tag.color) === c && (
                      <Check className="text-background size-3" aria-hidden="true" />
                    )}
                  </button>
                ))}
              </span>
              <span className="ms-auto flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={pending || i === 0}
                  aria-label={`Move ${tag.name} up`}
                  onClick={() => run(() => moveEventTag(orgId, { id: tag.id, direction: "up" }))}
                >
                  <ArrowUp className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={pending || i === tags.length - 1}
                  aria-label={`Move ${tag.name} down`}
                  onClick={() => run(() => moveEventTag(orgId, { id: tag.id, direction: "down" }))}
                >
                  <ArrowDown className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={pending}
                  aria-label={`Delete ${tag.name}`}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Delete the type “${tag.name}”?`,
                      description:
                        "Its events stay on the calendar, with no type until you give them one.",
                      confirmLabel: "Delete type",
                      run: async () => {
                        const result = await deleteEventTag(orgId, { id: tag.id });
                        return "error" in result ? result.error : undefined;
                      },
                    });
                    if (ok) router.refresh();
                  }}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="new-event-type" className="sr-only">
          New type
        </label>
        <Input
          id="new-event-type"
          value={adding}
          maxLength={MAX_TAG_NAME}
          disabled={pending || full}
          placeholder={full ? "That's the lot" : "Add a type — “Rehearsal”, “Standup”…"}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className={cn("max-w-xs", full && "opacity-60")}
        />
        <Button type="button" onClick={add} disabled={pending || full || !adding.trim()}>
          <Plus className="size-4" aria-hidden="true" />
          Add
        </Button>
      </div>
      {full && (
        <p className="text-muted-foreground text-sm">
          A calendar holds {MAX_TAGS_PER_ORG} types. Delete one to add another.
        </p>
      )}
      {confirmEl}
    </div>
  );
}

/** One type's name: edited in place, saved on blur or Enter. */
function NameField({
  tag,
  disabled,
  onSave,
}: {
  tag: EventTagOption;
  disabled?: boolean;
  onSave: (name: string) => void;
}) {
  const [draft, setDraft] = useState(tag.name);
  const commit = () => {
    const name = draft.trim();
    if (!name || name === tag.name) {
      setDraft(tag.name);
      return;
    }
    onSave(name);
  };
  return (
    <>
      <label htmlFor={`type-${tag.id}`} className="sr-only">
        Name
      </label>
      <Input
        id={`type-${tag.id}`}
        value={draft}
        disabled={disabled}
        maxLength={MAX_TAG_NAME}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") setDraft(tag.name);
        }}
        className="h-9 w-44 min-w-0"
      />
    </>
  );
}
