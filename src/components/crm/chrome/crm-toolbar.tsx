"use client";

import {
  Check,
  ChevronDown,
  Globe,
  Search,
  UserRound,
  UsersRound,
  type IconComponent,
} from "@/components/icons";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";

import { useCrmOpen } from "@/components/crm/card/use-crm-open";
import { CrmTabs } from "@/components/crm/crm-tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FilterSheet, PhoneToolbar } from "@/components/ui/phone-toolbar";
import { SearchField } from "@/components/ui/search-field";
import { chipClass, Segmented } from "@/components/ui/segmented";
import { ExpandChip, FilterPill, FiltersMenu } from "@/components/ui/toolbar-chips";
import { ASK_DRAFT_KEY, looksLikeAsk } from "@/lib/crm/ask-intent";
import type { ResolvedCrmTab } from "@/lib/crm/nav";
import type { CrmScope } from "@/lib/crm/scope";
import {
  hasModifier,
  isTypingTarget,
  overlayOpen,
  SCOPE_KEYS,
  SEQUENCE_TIMEOUT_MS,
} from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

/** Whose records, as Tasks' scope chips: Mine, My team (with reports), Everyone. */
export const CRM_SCOPE_ICONS: Record<CrmScope, IconComponent> = {
  mine: UserRound,
  team: UsersRound,
  all: Globe,
};

export interface CrmScopeBar {
  /** In order; My team only for someone with people under them. */
  options: readonly { value: CrmScope; label: string }[];
  /** The one on, or null when a filter pins one person instead. */
  value: CrmScope | null;
  onSelect: (value: CrmScope) => void;
}

export interface CrmViewBar {
  /** For screen readers ("Show"). */
  label: string;
  value: string;
  options: readonly { value: string; label: string; icon: IconComponent }[];
  onSelect: (value: string) => void;
}

/** What's narrowing the list, each removable on its own (Tasks' FilterPill row). */
export interface CrmFilterChip {
  key: string;
  label: string;
  onClear: () => void;
}

/**
 * Single keys on a CRM page, as Tasks has them (src/lib/shortcuts.ts):
 * never while typing, with a modifier, or with a menu or dialog open, and
 * never the letter after `g` (that's the app's go-to). Read before the
 * app's own keys, so `c` makes the CRM's new record here.
 */
export function useCrmKeys(keys: Readonly<Record<string, (() => void) | undefined>>) {
  const ref = useRef(keys);
  useEffect(() => {
    ref.current = keys;
  });
  useEffect(() => {
    let gAt = 0;
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || hasModifier(event) || isTypingTarget(event)) return;
      const key = event.key.toLowerCase();
      const afterG = Date.now() - gAt < SEQUENCE_TIMEOUT_MS;
      gAt = key === "g" && !event.shiftKey ? Date.now() : 0;
      if (afterG || overlayOpen()) return;
      const run = ref.current[key];
      if (!run) return;
      event.preventDefault();
      run();
    }
    document.addEventListener("keydown", onKey, { capture: true });
    return () => document.removeEventListener("keydown", onKey, { capture: true });
  }, []);
}

/**
 * The CRM's toolbar, Tasks' toolbar in the CRM: the tab switch, the view
 * switch as labelled pills (People, Companies, Board), whose records as
 * Tasks' scope chips (Mine, My team, Everyone; M, T and E), the page's own
 * buttons (`children`), Filters (every picker lives in there), a spacer,
 * and search as a pill that takes what room is left. Under it, the filters
 * that are on as removable chips with Clear all. On a phone it is Tasks'
 * phone bar: the scope as icons, Filters as a sheet from the bottom, and
 * search behind its icon. Search writes ?q= to the URL, so a search is a
 * link. No stat strips.
 */
export function CrmToolbar({
  tabs,
  children,
  views,
  scope,
  filters,
  filterCount = 0,
  chips,
  onClearAll,
  search,
  right,
  sheetTitle = "Filters",
}: {
  tabs: readonly ResolvedCrmTab[];
  /** The page's own buttons and pills, after the scope. */
  children?: ReactNode;
  /** The view switch (People, Companies, Board). */
  views?: CrmViewBar;
  /** Whose records (Mine, My team, Everyone). */
  scope?: CrmScopeBar;
  /** Filters' panel: one picker per entry, under its name. None, no Filters. */
  filters?: readonly { name: string; node: ReactNode }[];
  filterCount?: number;
  /** The filters that are on, each removable (none on, no row). */
  chips?: readonly CrmFilterChip[];
  /** Clear all: every filter and the search off (the view and scope stay). */
  onClearAll?: () => void;
  /** The search pill (none without it). */
  search?: { placeholder: string; param?: string };
  /** Beside the search, on the right (a Report link). */
  right?: ReactNode;
  /** The phone's filter sheet's title ("Filter people"). */
  sheetTitle?: string;
}) {
  const [sheet, setSheet] = useState(false);
  const { params, set } = useParamSetter();
  const param = search?.param ?? "q";
  const scopeKey = (v: CrmScope) =>
    scope?.options.some((o) => o.value === v) ? () => scope.onSelect(v) : undefined;
  useCrmKeys({
    [SCOPE_KEYS.mine!]: scopeKey("mine"),
    [SCOPE_KEYS.team!]: scopeKey("team"),
    [SCOPE_KEYS.all!]: scopeKey("all"),
  });
  const hasFilters = Boolean(filters && filters.length > 0);
  return (
    <div className="@container/crmbar space-y-3">
      {/* A phone: the tabs, then Tasks' phone bar. */}
      <div className="flex flex-col gap-2 md:hidden">
        <CrmTabs tabs={tabs} className="w-full shrink-0" />
        {(scope || views || hasFilters || search) && (
          <PhoneToolbar
            leading={
              scope ? (
                <Segmented
                  label="Whose"
                  value={scope.value ?? ""}
                  onSelect={(v) => scope.onSelect(v as CrmScope)}
                  options={scope.options.map((o) => ({
                    value: o.value,
                    label: o.label,
                    icon: CRM_SCOPE_ICONS[o.value],
                    compact: true,
                    title: o.label,
                  }))}
                  className="[&>button]:px-2.5"
                />
              ) : undefined
            }
            middle={
              views ? (
                <Segmented
                  label={views.label}
                  value={views.value}
                  onSelect={views.onSelect}
                  options={views.options.map((o) => ({
                    value: o.value,
                    label: o.label,
                    icon: o.icon,
                  }))}
                  className="w-full [&>button]:flex-1 [&>button]:justify-center"
                />
              ) : undefined
            }
            filterCount={filterCount}
            onFilters={() => setSheet(true)}
            searchLabel={search?.placeholder ?? "Search"}
            searchActive={Boolean(params.get(param))}
            search={
              search ? <CrmSearch placeholder={search.placeholder} param={param} phone /> : null
            }
            onCancelSearch={() => {
              if (params.get(param)) set({ [param]: null });
            }}
          />
        )}
        {(children || right) && (
          <div className="flex flex-wrap items-center gap-2">
            {children}
            {right}
          </div>
        )}
        <FilterSheet
          open={sheet}
          onOpenChange={setSheet}
          title={sheetTitle}
          canClear={Boolean(chips && chips.length > 0)}
          onClear={() => onClearAll?.()}
        >
          {(filters ?? []).map((f) => (
            <fieldset key={f.name} className="min-w-0">
              <legend className="text-muted-foreground mb-2 text-[13px] font-medium">
                {f.name}
              </legend>
              {f.node}
            </fieldset>
          ))}
        </FilterSheet>
      </div>

      <div className="flex flex-wrap items-center gap-2 max-md:hidden">
        <CrmTabs tabs={tabs} className="shrink-0" />
        {views && (
          <Segmented
            label={views.label}
            value={views.value}
            onSelect={views.onSelect}
            options={views.options.map((o) => ({
              value: o.value,
              label: o.label,
              icon: o.icon,
              compact: true,
              title: o.label,
            }))}
            // The first thing to go when the bar tightens, as in Tasks.
            labelsFrom="sr-only @[56rem]/crmbar:not-sr-only"
            className="shrink-0"
          />
        )}
        {scope && (
          <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Whose">
            {scope.options.map((o) => (
              <ExpandChip
                key={o.value}
                icon={CRM_SCOPE_ICONS[o.value]}
                label={o.label}
                active={scope.value === o.value}
                onClick={() => scope.onSelect(o.value)}
                title={`${o.label} (${SCOPE_KEYS[o.value]})`}
              />
            ))}
          </div>
        )}
        {children}
        {filters && filters.length > 0 && <FiltersMenu count={filterCount} items={filters} />}
        <span aria-hidden="true" className="min-w-0 flex-1" />
        {right}
        {search && <CrmSearch placeholder={search.placeholder} param={param} />}
      </div>

      {chips && chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <FilterPill key={c.key} label={c.label} onClear={c.onClear} />
          ))}
          {onClearAll && (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground ms-1 text-xs underline-offset-4 hover:underline"
              onClick={onClearAll}
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** One URL param, set or removed, keeping the rest (and dropping `open`: the list changed under it). */
export function useParamSetter() {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const hrefWith = (patch: Record<string, string | null | undefined>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
  const set = (patch: Record<string, string | null | undefined>) =>
    start(() => router.replace(hrefWith(patch), { scroll: false }));
  return { params, set, hrefWith, pending };
}

/**
 * A picker for the Filters panel: a pill naming the choice, a menu of the
 * rest. Writes `param` to the URL; the first option (value "") is "any".
 */
export function CrmFilterPick({
  param,
  icon: Icon,
  options,
  also,
}: {
  param: string;
  icon?: IconComponent;
  options: readonly { value: string; label: string }[];
  /** Other params set (or cleared, with null) with the pick: a new pipeline clears the stage. */
  also?: Record<string, string | null>;
}) {
  const { params, set } = useParamSetter();
  const value = params.get(param) ?? "";
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={chipClass(Boolean(value))}>
          {Icon && <Icon className="size-3.5" aria-hidden="true" />}
          <span className="max-w-40 truncate">{current?.label}</span>
          <ChevronDown className="size-3 opacity-60" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
        {options.map((o) => (
          <DropdownMenuItem
            key={o.value || "any"}
            onSelect={() => set({ ...also, [param]: o.value || null })}
          >
            <Check
              className={cn("size-4", o.value === value ? "opacity-100" : "opacity-0")}
              aria-hidden="true"
            />
            {o.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Search as a pill: 180px to 340px of whatever room the bar has left; on a
 * narrow bar just the magnifier, which opens the box. `/` focuses it.
 * It is also Ask: Enter on a question, a change or a sentence (or
 * Ctrl/Cmd+Enter on anything) opens the Ask card with it (?open=ask).
 */
function CrmSearch({
  placeholder,
  param,
  phone = false,
}: {
  placeholder: string;
  param: string;
  /** The phone bar's box: always open, focused when it appears. */
  phone?: boolean;
}) {
  const { params, set } = useParamSetter();
  const { setOpen } = useCrmOpen();
  const asking = useRef(false);
  const ask = (text: string) => {
    asking.current = true;
    try {
      sessionStorage.setItem(ASK_DRAFT_KEY, text);
    } catch {
      // No storage: Ask opens empty.
    }
    setDraft(committed);
    setOpen("ask");
  };
  const committed = params.get(param) ?? "";
  const [draft, setDraft] = useState(committed);
  const [wide, setWide] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Someone else changed the URL (Back, a cleared filter): follow it.
  const [seen, setSeen] = useState(committed);
  if (seen !== committed) {
    setSeen(committed);
    setDraft(committed);
  }

  useEffect(() => {
    if (phone) return;
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || isTypingTarget(event)) return;
      if (event.key === "/" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setWide(true);
        requestAnimationFrame(() => input.current?.focus());
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phone]);

  const commit = (value: string) => {
    if (value !== committed) set({ [param]: value || null });
  };
  const open = phone || wide || Boolean(committed);
  return (
    <>
      <button
        type="button"
        aria-label={placeholder}
        title={`${placeholder} (/)`}
        onClick={() => {
          setWide(true);
          requestAnimationFrame(() => input.current?.focus());
        }}
        className={cn(
          chipClass(false),
          "w-10 justify-center px-0",
          open ? "hidden" : "@[46rem]/crmbar:hidden",
        )}
        hidden={phone}
      >
        <Search className="size-4" aria-hidden="true" />
      </button>
      <div
        style={phone ? undefined : { flex: "1 1 180px" }}
        className={cn(
          "min-w-0",
          phone ? "w-full" : "max-w-[340px]",
          open ? "block" : "hidden @[46rem]/crmbar:block",
        )}
      >
        <SearchField
          ref={input}
          autoFocus={phone}
          value={draft}
          onValueChange={setDraft}
          onClear={() => commit("")}
          hint={looksLikeAsk(draft) ? "Enter asks" : "/"}
          placeholder={placeholder}
          aria-label={placeholder}
          className="w-full sm:w-full"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const text = draft.trim();
              if (text && (e.metaKey || e.ctrlKey || looksLikeAsk(text))) {
                e.preventDefault();
                ask(text);
                e.currentTarget.blur();
              } else commit(text);
            }
            if (e.key === "Escape" && !phone) {
              setDraft("");
              commit("");
              setWide(false);
              e.currentTarget.blur();
            }
          }}
          onBlur={() => {
            if (asking.current) {
              asking.current = false;
              return;
            }
            commit(draft.trim());
            if (!draft.trim()) setWide(false);
          }}
        />
      </div>
    </>
  );
}
