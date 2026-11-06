"use client";

import { Loader2, Pencil } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";

import { updateEvent } from "@/app/app/[orgSlug]/calendar/actions";
import { addLinkAction } from "@/app/app/[orgSlug]/links/actions";
import { searchWorkspaceAction } from "@/app/app/[orgSlug]/search/actions";
import { SavedMark, useSaveOnChange } from "@/components/ui/autosave";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { linkRefOfHit, type LinkRef } from "@/lib/links";
import type { SearchHit } from "@/lib/search/types";

/** "[Title](/app/...)": a link written into the agenda by @. */
const LINK = /\[([^\]\n]{1,120})\]\((\/app\/[^)\s]+)\)/g;
/** "@" and what's typed after it, up to the caret. */
const AT = /(?:^|\s)@([^\s@[\]()]{2,40})$/;

/**
 * A meeting's agenda (its description), as the workspace plan draws it: the
 * text with anything linked by @ shown as a chip, and, for those who can
 * edit the meeting, editable in place. Typing @ and two letters searches the
 * whole space (tasks, forms, files, people, budget lines…); picking one
 * writes it as a link and links it to this meeting both ways, so it shows in
 * the Linked panel too. It saves when you click away.
 */
export function MeetingAgenda({
  orgId,
  orgSlug,
  eventId,
  initial,
  canEdit,
  aside = null,
}: {
  orgId: string;
  orgSlug: string;
  eventId: string;
  initial: string | null;
  canEdit: boolean;
  /** Its ambient buttons (Carry them over), under the heading. */
  aside?: React.ReactNode;
}) {
  const router = useRouter();
  const [text, setText] = useState(initial ?? "");
  const [editing, setEditing] = useState(false);
  const { status, error, save } = useSaveOnChange(
    async (description: string) => {
      const result = await updateEvent(orgId, eventId, { description: description || null });
      if (result.error) return result.error;
      router.refresh();
    },
    { initial: initial ?? "" },
  );

  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const asked = useRef(0);

  useEffect(() => {
    if (query === null) return;
    const n = ++asked.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const result = await searchWorkspaceAction(orgId, { query, scope: "all" });
        if (n !== asked.current) return;
        setHits(
          result.groups
            .flatMap((g) => g.hits)
            .filter((h) => {
              const at = linkRefOfHit(h);
              return at && !(at.kind === "event" && at.id === eventId);
            })
            .slice(0, 8),
        );
        setHighlight(0);
      } finally {
        if (n === asked.current) setLoading(false);
      }
    }, 160);
    return () => clearTimeout(timer);
  }, [query, orgId, eventId]);

  function detect(value: string, caret: number) {
    const m = AT.exec(value.slice(0, caret));
    setQuery(m ? m[1]! : null);
  }

  function pick(hit: SearchHit) {
    const el = ref.current;
    const at = linkRefOfHit(hit) as LinkRef;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const m = AT.exec(before);
    if (!m) return;
    const start = caret - m[1]!.length - 1;
    const title =
      hit.title
        .replace(/[[\]()\n\r]/g, "")
        .trim()
        .slice(0, 120) || "Link";
    const token = `[${title}](${hit.href}) `;
    const next = text.slice(0, start) + token + text.slice(caret);
    setText(next);
    setQuery(null);
    void addLinkAction(orgId, orgSlug, { kind: "event", id: eventId }, at);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + token.length;
      el?.setSelectionRange(pos, pos);
    });
  }

  return (
    <section aria-labelledby="agenda-heading" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id="agenda-heading" className="heading text-[15px]">
          Agenda
        </h2>
        <span className="flex items-center gap-2">
          <SavedMark status={status} error={error} />
          {canEdit && !editing && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="size-3.5" aria-hidden="true" />
              Edit
            </Button>
          )}
        </span>
      </div>
      {!editing && aside}

      {editing ? (
        <Popover open={query !== null && (loading || hits.length > 0)}>
          <PopoverAnchor asChild>
            <Textarea
              ref={ref}
              autoFocus
              value={text}
              rows={Math.max(4, text.split("\n").length + 1)}
              placeholder="What's on the agenda? Type @ to link a task, form, file or person."
              aria-label="Agenda"
              onChange={(e) => {
                setText(e.target.value);
                detect(e.target.value, e.target.selectionStart ?? e.target.value.length);
              }}
              onKeyDown={(e) => {
                if (query !== null && hits.length > 0) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setHighlight((h) => (h + 1) % hits.length);
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setHighlight((h) => (h - 1 + hits.length) % hits.length);
                    return;
                  }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    pick(hits[highlight]!);
                    return;
                  }
                }
                if (e.key === "Escape") {
                  if (query !== null) setQuery(null);
                  else ref.current?.blur();
                }
              }}
              onBlur={() =>
                setTimeout(() => {
                  setQuery(null);
                  setEditing(false);
                  void save(text.trim());
                }, 150)
              }
              className="text-[15px] leading-relaxed"
            />
          </PopoverAnchor>
          <PopoverContent
            align="start"
            className="w-72 p-1"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            {loading && hits.length === 0 ? (
              <p className="text-muted-foreground flex items-center gap-2 px-2.5 py-2 text-sm">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                Searching
              </p>
            ) : (
              <ul role="listbox" aria-label="Link something">
                {hits.map((hit, i) => (
                  <li key={hit.key} role="option" aria-selected={i === highlight}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pick(hit);
                      }}
                      className="aria-selected:bg-muted hover:bg-muted rounded-field data-[on=true]:bg-muted flex w-full flex-col items-start px-2.5 py-1.5 text-left"
                      data-on={i === highlight}
                    >
                      <span className="text-sm font-medium break-words">{hit.title}</span>
                      {hit.detail && (
                        <span className="text-muted-foreground text-[12px] break-words">
                          {hit.detail}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </PopoverContent>
        </Popover>
      ) : text ? (
        <p className="text-[15px] leading-relaxed whitespace-pre-wrap">
          <AgendaText text={text} />
        </p>
      ) : (
        <p className="text-muted-foreground text-sm">
          {canEdit ? "No agenda yet. Edit to add one; type @ to link anything." : "No agenda yet."}
        </p>
      )}
    </section>
  );
}

/** The agenda's text, with @ links as chips. */
function AgendaText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(<Fragment key={`t${last}`}>{text.slice(last, at)}</Fragment>);
    parts.push(
      <Link
        key={`l${at}`}
        href={m[2]!}
        className="rounded-[5px] px-1.5 py-px font-semibold whitespace-nowrap text-(--tag-navy) underline-offset-2 hover:underline"
        style={{ background: "color-mix(in oklab, var(--tag-navy) 12%, transparent)" }}
      >
        {m[1]}
      </Link>,
    );
    last = at + m[0].length;
  }
  if (last < text.length) parts.push(<Fragment key={`t${last}`}>{text.slice(last)}</Fragment>);
  return <>{parts}</>;
}
