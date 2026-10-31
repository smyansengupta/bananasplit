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
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";

import { addLinkAction, removeLinkAction } from "@/app/app/[orgSlug]/links/actions";
import { searchWorkspaceAction } from "@/app/app/[orgSlug]/search/actions";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/toaster";
import { linkRefOfHit, type LinkedItem, type LinkKind, type LinkRef } from "@/lib/links";

import { SidePeek } from "./side-peek";
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

/**
 * Each kind's colour, from the fixed tag palette (src/lib/tag-colors.ts), so
 * a list of linked things reads as different things at a glance (the plan's
 * meeting page: a navy form, a teal database, a rust epic, an ochre budget).
 */
const TONES: Record<LinkKind, string> = {
  task: "var(--tag-rust)",
  event: "var(--tag-plum)",
  note: "var(--tag-plum)",
  file: "var(--tag-teal)",
  person: "var(--tag-forest)",
  database: "var(--tag-teal)",
  transaction: "var(--tag-ochre)",
  form: "var(--tag-navy)",
  budget: "var(--tag-ochre)",
  record: "var(--tag-teal)",
};

/** A row the page attaches itself (a meeting's notes): opens like a link, can't be unlinked here. */
export interface FixedLinkedRow {
  key: string;
  kind: LinkKind;
  title: string;
  detail: string;
  href: string;
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
  title = "Linked",
  closingTile = false,
  fixed = [],
  actions,
  omitKinds = NO_KINDS,
  className,
}: {
  orgId: string;
  orgSlug: string;
  /**
   * Kinds the page lists in a section of its own (a meeting's "Tasks from
   * this meeting"): left out here, and not offered to link from here.
   */
  omitKinds?: readonly LinkKind[];
  /** This page's own thing. */
  at: LinkRef;
  initial: LinkedItem[];
  /** The heading ("Linked to this meeting" on a meeting). */
  title?: string;
  /** Link from a dashed "+ Link something" tile closing the list, not a header button. */
  closingTile?: boolean;
  /** Rows the page attaches itself, listed after the links. */
  fixed?: readonly FixedLinkedRow[];
  /** Under the list, before the closing tile (e.g. Create meeting notes). */
  actions?: ReactNode;
  className?: string;
}) {
  const [all, setItems] = useState(initial);
  const items = all.filter((i) => !omitKinds.includes(i.kind));
  const [peek, setPeek] = useState<LinkedItem | null>(null);
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
          {title}
          {!closingTile && items.length + fixed.length > 0 && (
            <span className="text-muted-foreground ms-1.5 font-normal tabular-nums">
              {items.length + fixed.length}
            </span>
          )}
        </h2>
        {!closingTile && (
          <LinkPicker at={at} orgId={orgId} taken={all} omitKinds={omitKinds} onPick={link} />
        )}
      </div>
      {items.length + fixed.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((item) => {
            const Icon = ICONS[item.kind];
            return (
              <li
                key={item.linkId}
                style={{ ["--c" as string]: TONES[item.kind] }}
                className="group bg-card hover:bg-muted/40 relative flex items-start gap-2.5 rounded-[10px] border px-2.5 py-2 transition-colors"
              >
                <KindTile Icon={Icon} />
                <Link
                  href={item.href}
                  onClick={(e) => {
                    // A plain click peeks beside the page; Ctrl, Cmd, Shift
                    // or the middle button still open it as a page.
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                    e.preventDefault();
                    setPeek(item);
                  }}
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
          {fixed.map((row) => {
            const Icon = ICONS[row.kind];
            return (
              <li
                key={row.key}
                style={{ ["--c" as string]: TONES[row.kind] }}
                className="bg-card hover:bg-muted/40 relative flex items-start gap-2.5 rounded-[10px] border px-2.5 py-2 transition-colors"
              >
                <KindTile Icon={Icon} />
                <Link
                  href={row.href}
                  className="focus-visible:outline-foreground min-w-0 flex-1 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <span className="block text-[14px] leading-snug font-medium break-words">
                    {row.title}
                  </span>
                  <span className="text-muted-foreground block text-[12px]">{row.detail}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {actions}
      {closingTile && (
        <LinkPicker at={at} orgId={orgId} taken={all} omitKinds={omitKinds} onPick={link} tile />
      )}
      <SidePeek orgId={orgId} orgSlug={orgSlug} target={peek} onClose={() => setPeek(null)} />
    </section>
  );
}

/** A linked thing's icon on a wash of its kind's colour. */
function KindTile({ Icon }: { Icon: IconComponent }) {
  return (
    <span
      aria-hidden="true"
      className="mt-0.5 grid size-[22px] shrink-0 place-items-center rounded-[6px] text-(--c)"
      style={{ background: "color-mix(in oklab, var(--c) 14%, transparent)" }}
    >
      <Icon className="size-3.5" />
    </span>
  );
}

const NO_KINDS: readonly LinkKind[] = [];

/** "Link": search the space and pick something to link. */
function LinkPicker({
  at,
  orgId,
  taken,
  omitKinds,
  onPick,
  tile = false,
}: {
  at: LinkRef;
  orgId: string;
  taken: readonly LinkedItem[];
  omitKinds: readonly LinkKind[];
  onPick: (ref: LinkRef) => void;
  /** The plan's dashed "+ Link something" tile instead of a small button. */
  tile?: boolean;
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
              const ref = linkRefOfHit(h);
              if (!ref) return false;
              if (ref.kind === at.kind && ref.id === at.id) return false;
              if (omitKinds.includes(ref.kind)) return false;
              return !taken.some((t) => t.kind === ref.kind && t.id === ref.id);
            })
            .slice(0, 12),
        );
      } finally {
        if (n === asked.current) setLoading(false);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [open, query, orgId, at.kind, at.id, taken, omitKinds]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        {tile ? (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground hover:bg-muted/40 focus-glow flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-dashed px-2.5 py-2 text-[13px] font-medium outline-none"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Link something
          </button>
        ) : (
          <Button type="button" variant="ghost" size="sm">
            <Plus className="size-4" aria-hidden="true" />
            Link
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align={tile ? "center" : "end"} className="w-80 p-0">
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
            const ref = linkRefOfHit(hit)!;
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
