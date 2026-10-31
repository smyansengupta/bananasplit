"use client";

import {
  CalendarDays,
  CheckSquare,
  ClipboardList,
  Database,
  FileText,
  Link2,
  Loader2,
  NotebookText,
  PiggyBank,
  Plus,
  Search,
  Table,
  Users,
  Wallet,
  X,
  type IconComponent,
} from "@/components/icons";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import { addLinkAction, removeLinkAction } from "@/app/app/[orgSlug]/links/actions";
import { searchWorkspaceAction } from "@/app/app/[orgSlug]/search/actions";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/toaster";
import { linkKindOfSearch, type LinkedItem, type LinkKind, type LinkRef } from "@/lib/links";
import type { SearchHit } from "@/lib/search/types";
import { cn } from "@/lib/utils";

const ICONS: Record<LinkKind, IconComponent> = {
  task: CheckSquare,
  event: CalendarDays,
  note: NotebookText,
  file: FileText,
  person: Users,
  database: Database,
  transaction: Wallet,
  form: ClipboardList,
  budget: PiggyBank,
  record: Table,
};

/** A search hit's key is "{kind}:{id}"; the id may itself hold colons. */
function refOfHit(hit: SearchHit): LinkRef | null {
  const kind = linkKindOfSearch(hit.kind);
  if (!kind) return null;
  const at = hit.key.indexOf(":");
  const id = at === -1 ? "" : hit.key.slice(at + 1);
  return id ? { kind, id } : null;
}

/**
 * What this page is linked to, both ways: a meeting's sign-up form and
 * notes, a task's files, a person's budget line. "Link" searches everything
 * in the space (the ⌘K search) and links what you pick; × unlinks, with
 * Undo. Each row opens the thing itself.
 *
 * Titles come from the server as the viewer, so anything they can't open
 * isn't listed at all.
 */
export function LinkedPanel({
  orgId,
  orgSlug,
  at,
  initial,
  className,
}: {
  orgId: string;
  orgSlug: string;
  /** This page's own thing. */
  at: LinkRef;
  initial: LinkedItem[];
  className?: string;
}) {
  const [items, setItems] = useState(initial);
  const [, start] = useTransition();

  function link(ref: LinkRef) {
    start(async () => {
      const result = await addLinkAction(orgId, orgSlug, at, ref);
      if (result.error || !result.item) {
        toast({ title: result.error ?? "Couldn't link that.", tone: "error" });
        return;
      }
      const item = result.item;
      setItems((list) => [item, ...list.filter((i) => i.linkId !== item.linkId)]);
    });
  }

  function unlink(item: LinkedItem) {
    setItems((list) => list.filter((i) => i.linkId !== item.linkId));
    start(async () => {
      const result = await removeLinkAction(orgId, item.linkId);
      if (result.error) {
        setItems((list) => [item, ...list]);
        toast({ title: result.error, tone: "error" });
        return;
      }
      toast({
        title: "Unlinked",
        action: {
          label: "Undo",
          run: async () => {
            const back = await addLinkAction(orgId, orgSlug, at, { kind: item.kind, id: item.id });
            if (back.error || !back.item) return back.error ?? "Couldn't undo.";
            const again = back.item;
            setItems((list) => [again, ...list]);
          },
        },
      });
    });
  }

  return (
    <section
      aria-labelledby="linked-heading"
      className={cn("bg-card text-card-foreground edge rounded-card space-y-2 p-4", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="linked-heading" className="heading text-[15px]">
          Linked
          {items.length > 0 && (
            <span className="text-muted-foreground ms-1.5 font-normal tabular-nums">
              {items.length}
            </span>
          )}
        </h2>
        <LinkPicker at={at} orgId={orgId} taken={items} onPick={link} />
      </div>
      {items.length > 0 && (
        <ul className="-mx-1.5">
          {items.map((item) => {
            const Icon = ICONS[item.kind];
            return (
              <li
                key={item.linkId}
                className="group hover:bg-muted/60 rounded-field relative flex items-start gap-2.5 px-1.5 py-2"
              >
                <span className="bg-muted text-muted-foreground mt-0.5 grid size-7 shrink-0 place-items-center rounded-full">
                  <Icon className="size-3.5" aria-hidden="true" />
                </span>
                <Link
                  href={item.href}
                  className="focus-visible:outline-foreground min-w-0 flex-1 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <span className="block text-[14px] leading-snug font-medium break-words">
                    {item.title}
                  </span>
                  <span className="text-muted-foreground block text-[12px]">{item.detail}</span>
                </Link>
                <button
                  type="button"
                  onClick={() => unlink(item)}
                  aria-label={`Unlink ${item.title}`}
                  title="Unlink"
                  className="text-muted-foreground hover:text-foreground hover:bg-muted focus-glow grid size-7 shrink-0 place-items-center rounded-full opacity-0 outline-none group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** "Link": search the space and pick something to link. */
function LinkPicker({
  at,
  orgId,
  taken,
  onPick,
}: {
  at: LinkRef;
  orgId: string;
  taken: readonly LinkedItem[];
  onPick: (ref: LinkRef) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const asked = useRef(0);

  useEffect(() => {
    if (!open) return;
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
              const ref = refOfHit(h);
              if (!ref) return false;
              if (ref.kind === at.kind && ref.id === at.id) return false;
              return !taken.some((t) => t.kind === ref.kind && t.id === ref.id);
            })
            .slice(0, 12),
        );
      } finally {
        if (n === asked.current) setLoading(false);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [open, query, orgId, at.kind, at.id, taken]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          <Plus className="size-4" aria-hidden="true" />
          Link
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <label className="flex items-center gap-2 border-b px-3">
          <Search className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks, notes, meetings…"
            aria-label="Search to link"
            className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          {loading && (
            <Loader2 className="text-muted-foreground size-4 animate-spin" aria-hidden="true" />
          )}
        </label>
        <ul className="max-h-72 overflow-y-auto p-1">
          {hits.length === 0 && !loading && (
            <li className="text-muted-foreground px-3 py-3 text-sm">Nothing to link</li>
          )}
          {hits.map((hit) => {
            const ref = refOfHit(hit)!;
            const Icon = ICONS[ref.kind] ?? Link2;
            return (
              <li key={hit.key}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(ref);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="hover:bg-muted focus-visible:bg-muted rounded-field flex w-full items-start gap-2.5 px-2.5 py-2 text-left outline-none"
                >
                  <Icon
                    className="text-muted-foreground mt-0.5 size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium break-words">{hit.title}</span>
                    {hit.detail && (
                      <span className="text-muted-foreground block text-[12px] break-words">
                        {hit.detail}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
