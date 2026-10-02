"use client";

import { Command as CommandPrimitive } from "cmdk";
import { AlertCircle, Loader2, RotateCw, Search, SearchX } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { createNote } from "@/app/app/[orgSlug]/notes/actions";
import { usePins } from "@/components/pins/pins-context";
import { CommandDialog, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { toast } from "@/components/ui/toaster";
import type { Role } from "@/generated/prisma/enums";
import { can } from "@/lib/auth/permissions";
import { highlightRanges, parseQuery } from "@/lib/search/text";
import {
  GROUP_SCOPE,
  GROUP_SECTION,
  SEARCH_SCOPES,
  SERVER_GROUPS,
  type SearchScope,
} from "@/lib/search/types";
import { cn } from "@/lib/utils";

import { buildCatalog, type PaletteSection } from "./catalog";
import { paletteGroups, type PaletteItem } from "./palette-groups";
import { useModKey } from "./use-mod-key";
import { useWorkspaceSearch, type Searcher } from "./use-workspace-search";

/**
 * The ⌘K palette: one box that finds anything in the org (notes by what
 * they say, files, tasks, events, polls, people, roles, databases, finance,
 * every page and setting) and does a few things (new note, find a time,
 * pin, theme, switch org).
 *
 * Keys: ↑↓ move, ↵ opens, ⌘↵ (Ctrl+↵) opens in a new tab, Tab and
 * Shift+Tab step through the filters, Backspace in an empty box clears the
 * filter, Esc closes.
 */

const NAV_KEYS = new Set(["ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

function Highlight({ text, terms }: { text: string; terms: readonly string[] | null }) {
  const ranges = terms ? highlightRanges(text, terms) : [];
  if (!ranges.length) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <mark key={start} className="bg-primary/15 text-foreground rounded-[2px] font-semibold">
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="bg-muted text-muted-foreground inline-flex h-5 min-w-5 items-center justify-center rounded border px-1 font-sans text-[0.625rem] font-medium">
      {children}
    </kbd>
  );
}

export function CommandPalette({
  orgId,
  orgSlug,
  role,
  sections,
  orgs,
  open,
  onOpenChange,
  search,
}: {
  orgId: string;
  orgSlug: string;
  role: Role | null;
  /** Every sidebar section, hidden ones flagged (members don't search those). */
  sections: readonly PaletteSection[];
  orgs?: readonly { slug: string; name: string; pendingDeletion?: boolean }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tests swap the server search. */
  search?: Searcher;
}) {
  const router = useRouter();
  const pins = usePins();
  const { setTheme, forcedTheme } = useTheme();
  const mod = useModKey();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("all");
  const [selected, setSelected] = useState("");
  // Until the member moves through the list, the best match stays selected
  // as results arrive; after, their choice is kept while it's still listed.
  const [navigated, setNavigated] = useState(false);

  const result = useWorkspaceSearch(orgId, open, query, scope, search);
  const q = useMemo(() => parseQuery(query), [query]);

  const catalog = useMemo(
    () =>
      buildCatalog({
        orgSlug,
        role,
        sections,
        orgs,
        themeLocked: Boolean(forcedTheme),
        canPin: Boolean(pins),
      }),
    [orgSlug, role, sections, orgs, forcedTheme, pins],
  );

  // Filters for the sections this member can search (hidden ones drop out for members).
  const scopes = useMemo(() => {
    const admin = can({ role }, "settings.view");
    const hidden = new Set(sections.filter((s) => s.hidden).map((s) => s.id));
    return SEARCH_SCOPES.filter(
      (s) =>
        s.id === "all" ||
        s.id === "pages" ||
        SERVER_GROUPS.some((g) => {
          if (GROUP_SCOPE[g] !== s.id) return false;
          const section = GROUP_SECTION[g];
          return admin || !section || !hidden.has(section);
        }),
    );
  }, [role, sections]);

  const groups = useMemo(
    () => paletteGroups({ q, scope, catalog, response: result.response }),
    [q, scope, catalog, result.response],
  );
  const items = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const value =
    navigated && items.some((i) => i.key === selected) ? selected : (items[0]?.key ?? "");
  const resultCount = items.filter((i) => !i.more).length;
  const typed = q.folded.length > 0;
  const scopeLabel = SEARCH_SCOPES.find((s) => s.id === scope)?.label ?? "All";

  function changeQuery(next: string) {
    setQuery(next);
    setNavigated(false);
  }

  function changeScope(next: SearchScope) {
    setScope(next);
    setNavigated(false);
    inputRef.current?.focus();
  }

  async function newNote() {
    try {
      const res = await createNote(orgId);
      if (res.noteId) {
        router.push(`/app/${orgSlug}/notes/${res.noteId}`);
        return;
      }
      toast({ title: "Couldn't start a note", description: res.error, tone: "error" });
    } catch {
      toast({
        title: "Couldn't start a note",
        description: "Check your connection and try again.",
        tone: "error",
      });
    }
  }

  function run(item: PaletteItem, newTab = false) {
    const command = item.command;
    if (command.type === "href") {
      if (newTab) {
        window.open(command.href, "_blank", "noopener");
        return;
      }
      onOpenChange(false);
      router.push(command.href);
      return;
    }
    if (newTab) return;
    onOpenChange(false);
    if (command.type === "pin") pins?.openPicker();
    else if (command.type === "theme") setTheme(command.theme);
    else void newNote();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.nativeEvent.isComposing) return;
    // cmdk also moves with Ctrl+N/P and Ctrl+J/K.
    if (NAV_KEYS.has(event.key) || (event.ctrlKey && /^[njpk]$/.test(event.key))) {
      setNavigated(true);
      return;
    }
    if (event.key === "Tab" && scopes.length > 1) {
      // Keep the dialog's focus trap from moving focus out of the box.
      event.preventDefault();
      event.stopPropagation();
      const at = scopes.findIndex((s) => s.id === scope);
      const next = (at + (event.shiftKey ? -1 : 1) + scopes.length) % scopes.length;
      changeScope(scopes[next].id);
      return;
    }
    if (event.key === "Backspace" && query === "" && scope !== "all") {
      event.preventDefault();
      changeScope("all");
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      const item = items.find((i) => i.key === value);
      if (item) run(item, true);
    }
  }

  const placeholder =
    scope === "all"
      ? "Search notes, tasks, events, people, pages…"
      : `Search ${scopeLabel.toLowerCase()}…`;
  const showEmpty = typed && result.current && resultCount === 0;
  const showSkeleton = result.loading && items.length === 0 && (typed || scope !== "all");

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Search everything in this organization, or jump to a page"
      className="top-[8vh] flex max-h-[84vh] flex-col sm:top-[12vh] sm:max-w-2xl"
    >
      <CommandPrimitive
        shouldFilter={false}
        loop
        value={value}
        onValueChange={setSelected}
        onKeyDown={onKeyDown}
        className="bg-popover text-popover-foreground flex min-h-0 flex-1 flex-col overflow-hidden"
        label="Search"
      >
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
          <CommandPrimitive.Input
            ref={inputRef}
            value={query}
            onValueChange={changeQuery}
            placeholder={placeholder}
            maxLength={200}
            className="placeholder:text-muted-foreground h-12 min-w-0 flex-1 bg-transparent text-base outline-hidden sm:text-sm"
          />
          {result.loading && typed && (
            <Loader2
              className="text-muted-foreground size-4 shrink-0 animate-spin"
              aria-hidden="true"
            />
          )}
          <span className="hidden sm:inline-flex">
            <Kbd>esc</Kbd>
          </span>
        </div>

        {scopes.length > 1 && (
          <div
            role="group"
            aria-label="Filter results"
            className="no-scrollbar flex gap-1 overflow-x-auto border-b px-3 py-2"
          >
            {scopes.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={scope === s.id}
                onClick={() => changeScope(s.id)}
                onMouseDown={(e) => e.preventDefault()}
                className={cn(
                  "shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                  scope === s.id
                    ? "bg-primary text-primary-foreground border-transparent"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        <CommandList
          className="max-h-none min-h-0 flex-1 p-1 sm:max-h-[min(60vh,30rem)]"
          onPointerMove={() => setNavigated(true)}
        >
          {result.error && (
            <div
              role="alert"
              className="text-muted-foreground flex items-center gap-2 px-3 py-2 text-sm"
            >
              <AlertCircle className="text-destructive size-4 shrink-0" aria-hidden="true" />
              <span className="flex-1">Search didn&apos;t finish. Pages below still work.</span>
              <button
                type="button"
                onClick={result.retry}
                className="hover:bg-muted inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
              >
                <RotateCw className="size-3" aria-hidden="true" />
                Retry
              </button>
            </div>
          )}

          {showSkeleton && (
            <div className="space-y-1 p-1" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg px-2 py-2">
                  <div className="bg-muted size-8 animate-pulse rounded-md" />
                  <div className="flex-1 space-y-1.5">
                    <div className="bg-muted h-3 w-1/2 animate-pulse rounded" />
                    <div className="bg-muted h-2.5 w-3/4 animate-pulse rounded" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {showEmpty && (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm">
              <SearchX className="text-muted-foreground size-6" aria-hidden="true" />
              <p>
                Nothing {scope === "all" ? "" : `in ${scopeLabel.toLowerCase()} `}matches “{q.text}
                ”.
              </p>
              <p className="text-muted-foreground text-xs">
                Every word has to match somewhere. Try fewer or shorter words.
              </p>
              {scope !== "all" && (
                <button
                  type="button"
                  onClick={() => changeScope("all")}
                  className="hover:bg-muted mt-1 rounded-md border px-2.5 py-1 text-xs"
                >
                  Search everything instead
                </button>
              )}
            </div>
          )}

          {!typed &&
            scope !== "all" &&
            scope !== "pages" &&
            result.current &&
            resultCount === 0 && (
              <p className="text-muted-foreground px-6 py-10 text-center text-sm">
                Nothing in {scopeLabel.toLowerCase()} yet.
              </p>
            )}

          {groups.map((group) => (
            <CommandGroup key={group.id} heading={group.heading}>
              {group.items.map((item) => {
                const Icon = item.icon;
                const terms = item.highlight ? q.folded : null;
                return (
                  <CommandItem
                    key={item.key}
                    value={item.key}
                    onSelect={() => run(item)}
                    className={cn("gap-3 py-1.5", item.more && "text-muted-foreground")}
                  >
                    <span
                      className={cn(
                        "grid size-8 shrink-0 place-items-center rounded-md",
                        item.more ? "text-muted-foreground" : "bg-muted text-foreground",
                      )}
                    >
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">
                        <Highlight text={item.title} terms={terms} />
                      </span>
                      {item.detail && (
                        <span className="text-muted-foreground block truncate text-xs">
                          <Highlight text={item.detail} terms={terms} />
                        </span>
                      )}
                    </span>
                    {item.meta && (
                      <span
                        data-slot="command-shortcut"
                        className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums"
                      >
                        {item.meta}
                      </span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
        </CommandList>

        <div aria-live="polite" className="sr-only">
          {typed && result.current
            ? `${resultCount} ${resultCount === 1 ? "result" : "results"}`
            : ""}
        </div>

        <div className="text-muted-foreground hidden items-center gap-4 border-t px-3 py-2 text-[0.6875rem] sm:flex">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> move
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> open
          </span>
          <span className="flex items-center gap-1">
            <Kbd>{mod}</Kbd>
            <Kbd>↵</Kbd> new tab
          </span>
          {scopes.length > 1 && (
            <span className="flex items-center gap-1">
              <Kbd>tab</Kbd> filter
            </span>
          )}
        </div>
      </CommandPrimitive>
    </CommandDialog>
  );
}
