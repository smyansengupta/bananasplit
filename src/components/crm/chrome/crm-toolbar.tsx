"use client";

import { Check, ChevronDown, Search, type IconComponent } from "@/components/icons";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";

import { CrmTabs } from "@/components/crm/crm-tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SearchField } from "@/components/ui/search-field";
import { chipClass } from "@/components/ui/segmented";
import { ExpandChip, FiltersMenu } from "@/components/ui/toolbar-chips";
import type { ResolvedCrmTab } from "@/lib/crm/nav";
import { isTypingTarget } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

/**
 * The CRM's toolbar row, Tasks' toolbar in the CRM: the four-tab switch,
 * then the page's own round buttons (`children`), Filters (every picker
 * lives in there: lists, owner, pipeline), a spacer, and search as a pill
 * that takes what room is left (180px to 340px) and folds to its icon when
 * the bar is narrow. Search writes ?q= to the URL, so a search is a link.
 * No stat strips.
 */
export function CrmToolbar({
  tabs,
  children,
  filters,
  filterCount = 0,
  search,
  right,
}: {
  tabs: readonly ResolvedCrmTab[];
  /** The page's round buttons and pills, after the tabs. */
  children?: ReactNode;
  /** Filters' panel: one picker per entry, under its name. None, no Filters. */
  filters?: readonly { name: string; node: ReactNode }[];
  filterCount?: number;
  /** The search pill (none without it). */
  search?: { placeholder: string; param?: string };
  /** Beside the search, on the right (a Group-style pill). */
  right?: ReactNode;
}) {
  return (
    <div className="@container/crmbar">
      <div className="flex flex-wrap items-center gap-2">
        <CrmTabs tabs={tabs} className="shrink-0 max-md:w-full" />
        {children}
        {filters && filters.length > 0 && <FiltersMenu count={filterCount} items={filters} />}
        <span aria-hidden="true" className="min-w-0 flex-1" />
        {right}
        {search && <CrmSearch placeholder={search.placeholder} param={search.param ?? "q"} />}
      </div>
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
 * A round toggle in the bar (Mine, Everyone's): just its icon until you
 * hover it, then it says what it is. Writes `param=value` (or removes the
 * param for the default).
 */
export function CrmRoundToggle({
  icon,
  label,
  param,
  value,
  isDefault = false,
}: {
  icon: IconComponent;
  label: string;
  param: string;
  /** The value it sets; the default option clears the param. */
  value: string;
  isDefault?: boolean;
}) {
  const { params, set } = useParamSetter();
  const current = params.get(param);
  const active = isDefault ? !current || current === value : current === value;
  return (
    <ExpandChip
      icon={icon}
      label={label}
      active={active}
      onClick={() => set({ [param]: isDefault ? null : value })}
    />
  );
}

/**
 * A picker for the Filters panel: a pill naming the choice, a menu of the
 * rest. Writes `param` to the URL; the first option (value "") is "any".
 */
export function CrmFilterPick({
  param,
  icon: Icon,
  options,
}: {
  param: string;
  icon?: IconComponent;
  options: readonly { value: string; label: string }[];
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
            onSelect={() => set({ [param]: o.value || null })}
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
 */
function CrmSearch({ placeholder, param }: { placeholder: string; param: string }) {
  const { params, set } = useParamSetter();
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
  }, []);

  const commit = (value: string) => {
    if (value !== committed) set({ [param]: value || null });
  };
  const open = wide || Boolean(committed);
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
      >
        <Search className="size-4" aria-hidden="true" />
      </button>
      <div
        style={{ flex: "1 1 180px" }}
        className={cn("max-w-[340px] min-w-0", open ? "block" : "hidden @[46rem]/crmbar:block")}
      >
        <SearchField
          ref={input}
          value={draft}
          onValueChange={setDraft}
          onClear={() => commit("")}
          hint="/"
          placeholder={placeholder}
          aria-label={placeholder}
          className="w-full sm:w-full"
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(draft.trim());
            if (e.key === "Escape") {
              setDraft("");
              commit("");
              setWide(false);
              e.currentTarget.blur();
            }
          }}
          onBlur={() => {
            commit(draft.trim());
            if (!draft.trim()) setWide(false);
          }}
        />
      </div>
    </>
  );
}
