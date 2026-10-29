"use client";

import { Command as CommandPrimitive } from "cmdk";
import { AlertCircle, Loader2, RotateCw, Search, SearchX } from "@/components/icons";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { createNote } from "@/app/app/[orgSlug]/notes/actions";
import { usePins } from "@/components/pins/pins-context";
import { Button } from "@/components/ui/button";
import { CommandDialog, CommandList } from "@/components/ui/command";
import { chipClass } from "@/components/ui/segmented";
import { IconChip } from "@/components/ui/stat";
import { toast } from "@/components/ui/toaster";
import type { Role } from "@/generated/prisma/enums";
import { can } from "@/lib/auth/permissions";
import { highlightRanges, parseQuery } from "@/lib/search/text";
import { OPEN_SHORTCUTS_EVENT } from "@/lib/shortcuts";
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
 *
 * Moonstone: a level-2 float (the dialog), a pill search field, results as
 * soft tiles with their icon in a circle, the selected row tinted with the
 * glow and marked ↵.
 */

const NAV_KEYS = new Set(["ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

/**
 * The selected row: in light, the glow mixed in lightly (the table's
 * selected row); in dark, where the glow muddies, the stronger fill.
 */
const SELECTED_ROW =
  "data-[selected=true]:bg-[color-mix(in_oklab,var(--glow)_16%,transparent)] dark:data-[selected=true]:bg-muted-strong/70";

function Highlight({ text, terms }: { text: string; terms: readonly string[] | null }) {
  const ranges = terms ? highlightRanges(text, terms) : [];
  if (!ranges.length) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <mark
        key={start}
        className="text-foreground decoration-glow bg-transparent font-semibold underline decoration-2 underline-offset-[3px]"
      >
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "bg-muted-strong/60 text-foreground/75 inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1.5 font-mono text-[11px] leading-none font-medium",
        className,
      )}
    >
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
  orgs?: readonly { slug: string; name: string; kind?: string; pendingDeletion?: boolean }[];
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
    else if (command.type === "shortcuts") window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT));
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
        <div className="px-3 pt-3 sm:px-4 sm:pt-4">
          <div className="relative">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <CommandPrimitive.Input
              ref={inputRef}
              value={query}
              onValueChange={changeQuery}
              placeholder={placeholder}
              maxLength={200}
              className="border-input bg-card placeholder:text-muted-foreground h-10 w-full min-w-0 rounded-full border ps-10 pe-10 text-base outline-none sm:pe-20 sm:text-sm"
            />
            <span className="pointer-events-none absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-2">
              {result.loading && typed && (
                <Loader2
                  className="text-muted-foreground size-4 shrink-0 animate-spin"
                  aria-hidden="true"
                />
              )}
              <Kbd className="hidden sm:inline-flex">esc</Kbd>
            </span>
          </div>
        </div>

        {scopes.length > 1 && (
          <div
            role="group"
            aria-label="Filter results"
            className="no-scrollbar flex gap-1.5 overflow-x-auto [mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-28px),transparent)] px-3 pt-3 pb-1 sm:[mask-image:linear-gradient(to_right,transparent,black_16px,black_calc(100%-32px),transparent)] sm:px-4"
          >
            {scopes.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={scope === s.id}
                onClick={() => changeScope(s.id)}
                onMouseDown={(e) => e.preventDefault()}
                className={chipClass(scope === s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        <CommandList
          className="max-h-none min-h-0 flex-1 scroll-py-2 px-2 pt-1 pb-2 sm:max-h-[min(60vh,30rem)]"
          onPointerMove={() => setNavigated(true)}
        >
          {result.error && (
            <div
              role="alert"
              className="bg-tint-danger text-tint-danger-foreground rounded-tile mx-1 mt-2 flex items-center gap-2.5 p-3 text-sm"
            >
              <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
              <span className="flex-1">Search didn&apos;t finish. Pages below still work.</span>
              <Button type="button" variant="outline" size="sm" onClick={result.retry}>
                <RotateCw data-icon="inline-start" aria-hidden="true" />
                Retry
              </Button>
            </div>
          )}

          {showSkeleton && (
            <div className="space-y-0.5 pt-2" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex min-h-12 items-center gap-3 px-2.5 py-1.5">
                  <div className="bg-muted size-9 shrink-0 animate-pulse rounded-full" />
                  <div className="flex-1 space-y-2">
                    <div className="bg-muted h-3 w-1/2 animate-pulse rounded-full" />
                    <div className="bg-muted h-2.5 w-3/4 animate-pulse rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {showEmpty && (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm">
              <span className="bg-muted text-muted-foreground mb-1 grid size-12 place-items-center rounded-full">
                <SearchX className="size-5" aria-hidden="true" />
              </span>
              <p className="heading text-[15px]">
                Nothing {scope === "all" ? "" : `in ${scopeLabel.toLowerCase()} `}matches “{q.text}
                ”.
              </p>
              <p className="text-muted-foreground max-w-[38ch]">
                Every word has to match somewhere. Try fewer or shorter words.
              </p>
              {scope !== "all" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => changeScope("all")}
                  className="mt-1"
                >
                  Search everything instead
                </Button>
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
            <CommandPrimitive.Group
              key={group.id}
              heading={group.heading}
              className="**:[[cmdk-group-heading]]:eyebrow **:[[cmdk-group-heading]]:text-muted-foreground pt-1 **:[[cmdk-group-heading]]:px-2.5 **:[[cmdk-group-heading]]:pt-2.5 **:[[cmdk-group-heading]]:pb-1.5"
            >
              {group.items.map((item) => {
                const Icon = item.icon;
                const terms = item.highlight ? q.folded : null;
                return (
                  <CommandPrimitive.Item
                    key={item.key}
                    value={item.key}
                    onSelect={() => run(item)}
                    className={cn(
                      "group/row rounded-field relative flex min-h-12 cursor-default items-center gap-3 px-2.5 py-1.5 text-sm outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
                      SELECTED_ROW,
                      item.more && "text-muted-foreground data-[selected=true]:text-foreground",
                    )}
                  >
                    {item.more ? (
                      <span className="grid size-9 shrink-0 place-items-center" aria-hidden="true">
                        <Icon className="size-4" />
                      </span>
                    ) : (
                      <IconChip
                        icon={Icon}
                        className="text-muted-foreground group-data-[selected=true]/row:text-foreground"
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate", !item.more && "font-medium")}>
                        <Highlight text={item.title} terms={terms} />
                      </span>
                      {item.detail && (
                        <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                          <Highlight text={item.detail} terms={terms} />
                        </span>
                      )}
                    </span>
                    {item.meta && (
                      <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
                        {item.meta}
                      </span>
                    )}
                    <Kbd className="bg-card ring-foreground/6 hidden ring-1 sm:group-data-[selected=true]/row:inline-flex">
                      ↵
                    </Kbd>
                  </CommandPrimitive.Item>
                );
              })}
            </CommandPrimitive.Group>
          ))}
        </CommandList>

        <div aria-live="polite" className="sr-only">
          {typed && result.current
            ? `${resultCount} ${resultCount === 1 ? "result" : "results"}`
            : ""}
        </div>

        <div className="bg-muted/50 text-muted-foreground hidden items-center gap-5 px-4 py-2.5 text-xs sm:flex">
          <span className="flex items-center gap-1.5">
            <span className="flex gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
            </span>
            Move
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd> Open
          </span>
          <span className="flex items-center gap-1.5">
            <span className="flex gap-1">
              <Kbd>{mod}</Kbd>
              <Kbd>↵</Kbd>
            </span>
            New tab
          </span>
          {scopes.length > 1 && (
            <span className="flex items-center gap-1.5">
              <Kbd>tab</Kbd> Filter
            </span>
          )}
        </div>
      </CommandPrimitive>
    </CommandDialog>
  );
}
