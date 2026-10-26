"use client";

import { ArrowUpRight, ChevronDown, LayoutGrid, List, Search, X } from "@/components/icons";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { loadPersonSheetAction, searchPeopleAction } from "@/app/app/[orgSlug]/people/actions";
import { EmptyState } from "@/components/empty-state";
import { useMediaQuery } from "@/components/org-chart/use-media-query";
import { PinToggle } from "@/components/pins/pins-context";
import { Button } from "@/components/ui/button";
import { TagChip } from "@/components/ui/chip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FilterChoices, FilterSheet, PhoneToolbar } from "@/components/ui/phone-toolbar";
import { SearchField } from "@/components/ui/search-field";
import { Segmented, chipClass } from "@/components/ui/segmented";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { UserAvatar } from "@/components/user-avatar";
import { personHref } from "@/lib/profile/href";
import { cn } from "@/lib/utils";
import type {
  DirectoryPerson,
  DirectoryTeam,
  PeopleSearchResult,
  PersonSheet,
} from "@/server/profiles/directory";

import {
  applyFilters,
  groupPeople,
  localMatch,
  teamName,
  type PeopleGroup,
} from "./directory-model";
import {
  DIRECTORY_ROLES,
  directorySearch,
  NO_TEAM_KEY,
  type DirectoryQuery,
  type DirectoryRole,
} from "./directory-query";
import { PersonProfile, ROLE_LABELS } from "./person-profile";

/**
 * The people directory (Moonstone 12.1 and 12.2): search as you type
 * (the database does the matching, typo-tolerant, with an instant local
 * preview while it answers), filter pills for team, role, year and Free
 * now, sort by team, name or newest, grid or dense list, and the profile
 * sheet beside the list (full screen on phones). ↑ ↓ move between people,
 * Esc closes the sheet, and the whole state lives in the URL (?person=).
 * Big clubs render in pages of RENDER_STEP as you scroll, with an A-Z rail
 * when sorted by name.
 */

export const SEARCH_DEBOUNCE_MS = 140;
const RENDER_STEP = 120;

export interface PeopleDirectoryProps {
  orgId: string;
  orgSlug: string;
  orgTimezone: string;
  viewerId: string;
  people: DirectoryPerson[];
  teams: DirectoryTeam[];
  total: number;
  initial: DirectoryQuery;
  initialSheet: PersonSheet | null;
  search?: (orgId: string, q: string) => Promise<PeopleSearchResult>;
  loadSheet?: (orgId: string, userId: string) => Promise<PersonSheet | null>;
}

type Row = { kind: "header"; group: PeopleGroup } | { kind: "person"; person: DirectoryPerson };

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
}

export function PeopleDirectory({
  orgId,
  orgSlug,
  orgTimezone,
  viewerId,
  people,
  teams,
  total,
  initial,
  initialSheet,
  search = searchPeopleAction,
  loadSheet = loadPersonSheetAction,
}: PeopleDirectoryProps) {
  const pathname = usePathname();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const isPhone = useMediaQuery("(max-width: 767px)");
  const [query, setQuery] = useState<DirectoryQuery>(initial);
  const [results, setResults] = useState<{ q: string; result: PeopleSearchResult } | null>(null);
  const [limit, setLimit] = useState(RENDER_STEP);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sheets, setSheets] = useState<Map<string, PersonSheet>>(
    () => new Map(initialSheet ? [[initialSheet.id, initialSheet]] : []),
  );
  const listRef = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const latest = useRef("");

  const teamsByKey = useMemo(() => new Map(teams.map((t) => [t.key, t])), [teams]);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const roles = useMemo(
    () => DIRECTORY_ROLES.filter((r) => people.some((p) => p.role === r)),
    [people],
  );
  const years = useMemo(
    () => [...new Set(people.map((p) => p.gradYear).filter((y): y is number => y !== null))].sort(),
    [people],
  );
  const freeCount = useMemo(() => people.filter((p) => p.freeNow).length, [people]);

  const update = useCallback((patch: Partial<DirectoryQuery>) => {
    setQuery((q) => ({ ...q, ...patch }));
    if (!("person" in patch)) setLimit(RENDER_STEP);
  }, []);

  // The URL follows the state (no navigation: history integrates with the router).
  useEffect(() => {
    const qs = directorySearch(query);
    const next = qs ? `${pathname}?${qs}` : pathname;
    if (next !== `${window.location.pathname}${window.location.search}`)
      window.history.replaceState(null, "", next);
  }, [query, pathname]);

  // Server search: one request per pause, only the newest answer kept.
  const term = query.q.trim();
  useEffect(() => {
    latest.current = term;
    if (!term) return;
    const id = window.setTimeout(() => {
      search(orgId, term)
        .then((result) => {
          if (latest.current === term) setResults({ q: term, result });
        })
        .catch(() => {
          if (latest.current === term)
            setResults({
              q: term,
              result: { ids: localMatch(people, term, teamsByKey).map((p) => p.id), close: false },
            });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [term, orgId, search, people, teamsByKey]);

  const answered = term && results?.q === term ? results.result : null;
  const matched = useMemo(() => {
    if (!term) return people;
    if (answered)
      return answered.ids.map((id) => byId.get(id)).filter((p): p is DirectoryPerson => Boolean(p));
    return localMatch(people, term, teamsByKey);
  }, [term, answered, people, byId, teamsByKey]);
  const filtered = useMemo(() => applyFilters(matched, query), [matched, query]);
  // A phone in a club with no org chart sorts by name: by team, everyone
  // would sit under one "Not on the chart".
  const sort = isPhone && teams.length === 0 && query.sort === "team" ? "name" : query.sort;
  const groups = useMemo(
    () => groupPeople(filtered, sort, teams, { ranked: Boolean(term) }),
    [filtered, sort, teams, term],
  );
  const ordered = useMemo(() => groups.flatMap((g) => g.people), [groups]);
  const rows = useMemo<Row[]>(
    () =>
      groups.flatMap((g) => [
        { kind: "header" as const, group: g },
        ...g.people.map((p) => ({ kind: "person" as const, person: p })),
      ]),
    [groups],
  );
  const visibleRows = rows.slice(0, limit);
  const close = Boolean(answered?.close);

  // Render more as the end of the list scrolls into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || limit >= rows.length || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setLimit((n) => n + RENDER_STEP);
      },
      { rootMargin: "600px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [limit, rows.length]);

  // ---------------------------------------------------------- the sheet

  const selectedId = query.person;
  const sheet = selectedId ? (sheets.get(selectedId) ?? null) : null;
  useEffect(() => {
    if (!selectedId || sheets.has(selectedId)) return;
    let live = true;
    loadSheet(orgId, selectedId)
      .then((data) => {
        if (!live) return;
        if (!data) {
          toast({ title: "That person isn't a member of this club anymore.", tone: "error" });
          update({ person: null });
          return;
        }
        setSheets((m) => new Map(m).set(data.id, data));
      })
      .catch(() => {
        if (live)
          toast({ title: "Couldn't load that profile. Check your connection.", tone: "error" });
      });
    return () => {
      live = false;
    };
  }, [selectedId, sheets, orgId, loadSheet, update]);

  const focusCard = useCallback((id: string) => {
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector<HTMLElement>(
        `[data-person-id="${CSS.escape(id)}"]`,
      );
      el?.focus({ preventScroll: false });
      el?.scrollIntoView({ block: "nearest" });
    });
  }, []);

  const step = useCallback(
    (direction: 1 | -1, from: string | null, open: boolean) => {
      if (!ordered.length) return;
      const i = from ? ordered.findIndex((p) => p.id === from) : -1;
      const next = ordered[Math.max(0, Math.min(ordered.length - 1, i < 0 ? 0 : i + direction))];
      const index = rows.findIndex((r) => r.kind === "person" && r.person.id === next.id);
      if (index >= limit) setLimit(index + RENDER_STEP);
      if (open) update({ person: next.id });
      focusCard(next.id);
    },
    [ordered, rows, limit, update, focusCard],
  );

  // While a sheet is open: Esc closes it, ↑ ↓ move to the next person.
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector("[role=menu], [role=dialog]:not([data-person-sheet])")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        const id = selectedId;
        update({ person: null });
        focusCard(id);
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if ((e.target as HTMLElement | null)?.closest?.("[data-person-list]")) return; // the list handles its own
        e.preventDefault();
        step(e.key === "ArrowDown" ? 1 : -1, selectedId, true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedId, step, update, focusCard]);

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-person-id]")?.dataset.personId;
    if (!id) return;
    e.preventDefault();
    step(e.key === "ArrowDown" ? 1 : -1, id, Boolean(selectedId));
  };

  const select = (id: string) => update({ person: id });

  // ---------------------------------------------------------- render

  const activeFilters = Boolean(query.team || query.role || query.year || query.free);
  const countText =
    filtered.length === total && !term && !activeFilters
      ? `${total} ${total === 1 ? "member" : "members"}`
      : `${filtered.length} of ${total} ${total === 1 ? "member" : "members"}`;
  const letters = sort === "name" ? groups.map((g) => g.label) : [];

  const jump = (letter: string) => {
    const index = rows.findIndex((r) => r.kind === "header" && r.group.label === letter);
    if (index < 0) return;
    if (index >= limit) setLimit(index + RENDER_STEP);
    requestAnimationFrame(() =>
      document
        .getElementById(`people-letter-${letter}`)
        ?.scrollIntoView({ block: "start", behavior: "smooth" }),
    );
  };

  const profile = sheet ? (
    <PersonProfile
      person={sheet}
      orgSlug={orgSlug}
      viewerId={viewerId}
      timeZone={orgTimezone}
      headingId="person-sheet-title"
      onSelectPerson={(id) => (byId.has(id) ? select(id) : undefined)}
      extraActions={
        <>
          <PinToggle href={personHref(orgSlug, sheet.id)} label={sheet.name ?? "member"} />
          <Button asChild variant="outline" size="icon-sm" aria-label="Open the full page">
            <Link href={personHref(orgSlug, sheet.id)}>
              <ArrowUpRight aria-hidden="true" />
            </Link>
          </Button>
        </>
      }
    />
  ) : (
    <SheetSkeleton />
  );

  const layoutSwitch = (
    <Segmented
      label="Layout"
      value={query.view}
      onSelect={(view) => update({ view: view as DirectoryQuery["view"] })}
      options={[
        { value: "grid", label: "Grid", icon: LayoutGrid, compact: true, title: "Grid" },
        { value: "list", label: "List", icon: List, compact: true, title: "Dense list" },
      ]}
    />
  );

  return (
    <div className="grid items-start gap-[18px]">
      <section aria-label="Members" className="bg-card edge rounded-card min-w-0 p-[18px] sm:p-6">
        {/* A phone: the one list toolbar (as on Tasks and Files), with the sort on its left (grid and list are one and the same there). */}
        <PhoneToolbar
          leading={
            <Segmented
              label="Sort people"
              value={sort}
              onSelect={(v) => update({ sort: v as DirectoryQuery["sort"] })}
              options={[
                ...(teams.length > 0 ? [{ value: "team", label: "Team" }] : []),
                { value: "name", label: "A–Z" },
                { value: "new", label: "Newest" },
              ]}
            />
          }
          filterCount={[query.team, query.role, query.year, query.free].filter(Boolean).length}
          onFilters={() => setFiltersOpen(true)}
          searchLabel="Search people"
          searchActive={Boolean(query.q)}
          search={
            <SearchField
              value={query.q}
              onValueChange={(q) => update({ q: q.slice(0, 80) })}
              onClear={() => update({ q: "" })}
              placeholder="Name, title, team or major"
              aria-label="Search people"
              maxLength={80}
              autoComplete="off"
              autoFocus
            />
          }
          onCancelSearch={() => update({ q: "" })}
        />

        <FilterSheet
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          title="Filter people"
          description="The directory shows only the members who match."
          canClear={activeFilters}
          onClear={() => update({ team: null, role: null, year: null, free: false })}
        >
          <FilterChoices
            title="Free now"
            value={query.free ? "free" : ""}
            onPick={(v) => update({ free: v === "free" })}
            options={[
              { value: "", label: "Anyone" },
              {
                value: "free",
                label: `Free now${freeCount > 0 ? ` (${freeCount})` : ""}`,
                color: "var(--success)",
              },
            ]}
          />
          {teams.length > 0 && (
            <FilterChoices
              title="Team"
              value={query.team ?? ""}
              onPick={(v) => update({ team: v || null })}
              options={[
                { value: "", label: "All teams" },
                ...teams.map((t) => ({
                  value: t.key,
                  label: t.name,
                  color: `var(--chart-${((t.slot - 1) % 5) + 1})`,
                })),
                ...(people.some((p) => !p.teamKey)
                  ? [{ value: NO_TEAM_KEY, label: "Not on the chart" }]
                  : []),
              ]}
            />
          )}
          {roles.length > 1 && (
            <FilterChoices
              title="Role"
              value={query.role ?? ""}
              onPick={(v) => update({ role: (v || null) as DirectoryRole | null })}
              options={[
                { value: "", label: "All roles" },
                ...roles.map((r) => ({ value: r, label: ROLE_LABELS[r] })),
              ]}
            />
          )}
          {years.length > 0 && (
            <FilterChoices
              title="Year"
              value={query.year ? String(query.year) : ""}
              onPick={(v) => update({ year: v ? Number(v) : null })}
              options={[
                { value: "", label: "All years" },
                ...years.map((y) => ({ value: String(y), label: `Class of ${y}` })),
              ]}
            />
          )}
        </FilterSheet>

        <div className="flex flex-wrap items-center gap-2 max-md:hidden">
          <SearchField
            value={query.q}
            onValueChange={(q) => update({ q: q.slice(0, 80) })}
            onClear={() => update({ q: "" })}
            placeholder="Search by name, title, team or major"
            aria-label="Search people"
            className="min-w-[220px] flex-1 sm:w-auto"
            maxLength={80}
            autoComplete="off"
          />
          <Segmented
            label="Sort people"
            value={query.sort}
            onSelect={(sort) => update({ sort: sort as DirectoryQuery["sort"] })}
            options={[
              { value: "team", label: "Team" },
              { value: "name", label: "Name" },
              { value: "new", label: "Newest" },
            ]}
          />
          {layoutSwitch}
        </div>

        <div
          className="mt-3 flex flex-wrap items-center gap-2 max-md:hidden"
          role="group"
          aria-label="Filters"
        >
          <button
            type="button"
            aria-pressed={query.free}
            onClick={() => update({ free: !query.free })}
            className={chipClass(query.free)}
            title="Free now, from the busy times members share"
          >
            <span
              aria-hidden="true"
              className="bg-success size-2 rounded-full shadow-[0_0_0_3px_color-mix(in_oklab,var(--success)_24%,transparent)]"
            />
            Free now{freeCount > 0 && <span className="figure opacity-70">{freeCount}</span>}
          </button>
          {teams.length > 0 && (
            <FilterMenu
              label="Team"
              value={query.team}
              display={
                query.team === NO_TEAM_KEY
                  ? "Not on the chart"
                  : query.team
                    ? teamsByKey.get(query.team)?.name
                    : null
              }
              allLabel="All teams"
              options={[
                ...teams.map((t) => ({
                  value: t.key,
                  label: t.name,
                  color: `var(--chart-${((t.slot - 1) % 5) + 1})`,
                })),
                ...(people.some((p) => !p.teamKey)
                  ? [{ value: NO_TEAM_KEY, label: "Not on the chart" }]
                  : []),
              ]}
              onChange={(team) => update({ team })}
            />
          )}
          {roles.length > 1 && (
            <FilterMenu
              label="Role"
              value={query.role}
              display={query.role ? ROLE_LABELS[query.role] : null}
              allLabel="All roles"
              options={roles.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
              onChange={(role) => update({ role: role as DirectoryRole | null })}
            />
          )}
          {years.length > 0 && (
            <FilterMenu
              label="Year"
              value={query.year ? String(query.year) : null}
              display={query.year ? `Class of ${query.year}` : null}
              allLabel="All years"
              options={years.map((y) => ({ value: String(y), label: `Class of ${y}` }))}
              onChange={(year) => update({ year: year ? Number(year) : null })}
            />
          )}
          {activeFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => update({ team: null, role: null, year: null, free: false })}
            >
              <X aria-hidden="true" />
              Clear filters
            </Button>
          )}
          <span
            className="text-muted-foreground ml-auto text-[13px]"
            role="status"
            aria-live="polite"
          >
            {countText}
            {close && " · close matches"}
          </span>
        </div>

        <div className="relative mt-2 flex gap-3">
          <div ref={listRef} data-person-list onKeyDown={onListKey} className="min-w-0 flex-1">
            {people.length === 0 ? (
              <EmptyState title="No members yet" description="Invite people to see them here." />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={Search}
                title="No one matches that"
                description="Try a first name, a team or a year."
                action={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      update({ q: "", team: null, role: null, year: null, free: false })
                    }
                  >
                    Clear search and filters
                  </Button>
                }
              />
            ) : (
              <PeopleRows
                rows={visibleRows}
                view={isPhone ? "grid" : query.view}
                orgSlug={orgSlug}
                selectedId={selectedId}
                viewerId={viewerId}
                teamsByKey={teamsByKey}
                hideNoTeam={isPhone && teams.length === 0}
                onSelect={select}
              />
            )}
            {limit < rows.length && (
              <div ref={sentinel} className="text-muted-foreground py-6 text-center text-sm">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setLimit((n) => n + RENDER_STEP)}
                >
                  Show more (
                  {ordered.length - visibleRows.filter((r) => r.kind === "person").length} left)
                </Button>
              </div>
            )}
          </div>
          {letters.length > 4 && (
            <nav
              aria-label="Jump to a letter"
              className="sticky top-4 hidden max-h-[70vh] flex-col self-start overflow-y-auto sm:flex"
            >
              {letters.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => jump(l)}
                  className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-6 place-items-center rounded-full text-[11px] font-semibold"
                >
                  {l}
                </button>
              ))}
            </nav>
          )}
        </div>
      </section>

      {/*
        A centred dialog, like the task editor and New event, rather than a
        panel down the right: a profile is something you open, read and close,
        not something you work alongside, and the list no longer has to give
        up a third of its width whenever one is open.
      */}
      {isDesktop && (
        <Dialog
          open={Boolean(selectedId)}
          onOpenChange={(open) => {
            if (open) return;
            const id = selectedId;
            update({ person: null });
            if (id) focusCard(id);
          }}
        >
          <DialogContent
            className="max-h-[calc(100dvh-4rem)] overflow-y-auto p-0 sm:max-w-lg"
            aria-describedby={undefined}
          >
            <DialogTitle className="sr-only">{sheet?.name ?? "Profile"}</DialogTitle>
            {selectedId && profile}
          </DialogContent>
        </Dialog>
      )}

      {!isDesktop && (
        <Sheet
          open={Boolean(selectedId)}
          onOpenChange={(open) => !open && update({ person: null })}
        >
          <SheetContent
            side="bottom"
            data-person-sheet
            className="bg-raised h-[100dvh] max-h-[100dvh] gap-0 overflow-y-auto rounded-none p-0"
            aria-describedby={undefined}
          >
            <SheetTitle className="sr-only">{sheet?.name ?? "Profile"}</SheetTitle>
            {profile}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

function PeopleRows({
  rows,
  view,
  orgSlug,
  selectedId,
  viewerId,
  teamsByKey,
  onSelect,
  hideNoTeam = false,
}: {
  rows: Row[];
  view: DirectoryQuery["view"];
  orgSlug: string;
  selectedId: string | null;
  viewerId: string;
  teamsByKey: ReadonlyMap<string, DirectoryTeam>;
  /** A phone, in a club with no org chart: no "Not on the chart" on every card. */
  hideNoTeam?: boolean;
  onSelect: (id: string) => void;
}) {
  // Split the flat rows back into runs under each header.
  const blocks: { group: PeopleGroup; people: DirectoryPerson[] }[] = [];
  for (const row of rows) {
    if (row.kind === "header") blocks.push({ group: row.group, people: [] });
    else blocks.at(-1)?.people.push(row.person);
  }
  return (
    <div className="flex flex-col">
      {blocks.map(({ group, people }) => (
        <section key={group.key} aria-labelledby={`people-${group.key}`}>
          <h2
            id={`people-${group.key}`}
            className="text-muted-foreground mt-5 mb-2.5 flex scroll-mt-4 items-center gap-2 text-[13px] font-semibold first:mt-3"
          >
            {group.color && (
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ background: group.color }}
              />
            )}
            <span>{group.label}</span>
            <span className="bg-secondary text-muted-foreground rounded-full px-2 text-xs leading-5">
              {group.people.length}
            </span>
          </h2>
          {view === "grid" ? (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2.5">
              {people.map((p) => (
                <li key={p.id} className="min-w-0">
                  <PersonCard
                    person={p}
                    team={hideNoTeam ? "" : teamName(p, teamsByKey)}
                    selected={p.id === selectedId}
                    isSelf={p.id === viewerId}
                    onSelect={onSelect}
                    href={personHref(orgSlug, p.id)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <ul className="divide-border/70 flex flex-col divide-y">
              {people.map((p) => (
                <li key={p.id}>
                  <PersonRow
                    person={p}
                    team={p.teamKey ? teamsByKey.get(p.teamKey) : undefined}
                    selected={p.id === selectedId}
                    isSelf={p.id === viewerId}
                    onSelect={onSelect}
                    href={personHref(orgSlug, p.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function Presence({ person, size }: { person: DirectoryPerson; size: "lg" | "md" }) {
  return (
    <span className="relative inline-flex shrink-0">
      <UserAvatar user={person} size={size} />
      {person.freeNow && (
        <span
          aria-hidden="true"
          className={cn(
            "bg-success ring-card absolute right-0 bottom-0 rounded-full ring-2",
            size === "lg" ? "size-3" : "size-2.5",
          )}
        />
      )}
    </span>
  );
}

function PersonCard({
  person,
  team,
  selected,
  isSelf,
  onSelect,
  href,
}: {
  person: DirectoryPerson;
  team: string;
  selected: boolean;
  isSelf: boolean;
  onSelect: (id: string) => void;
  /** Their profile, for the right-click menu. */
  href: string;
}) {
  const name = person.name ?? "Unnamed member";
  return (
    <button
      type="button"
      data-person-id={person.id}
      data-context-href={href}
      data-context-label={name}
      aria-pressed={selected}
      onClick={() => onSelect(person.id)}
      className={cn(
        "bg-card text-card-foreground border-foreground/8 rounded-tile focus-glow hover:shadow-e1 flex w-full min-w-0 items-center gap-3 border p-3.5 text-left transition duration-200 ease-(--ease-ink) outline-none hover:-translate-y-px motion-reduce:transform-none",
        selected && "ring-brand-accent shadow-e1 ring-2",
      )}
    >
      <Presence person={person} size="lg" />
      <span className="min-w-0">
        <span className="block truncate text-sm leading-tight font-semibold">
          {name}
          {isSelf && <span className="text-muted-foreground ml-1 font-normal">(you)</span>}
        </span>
        <span className="text-muted-foreground block truncate text-[13px]">
          {[person.title, team].filter(Boolean).join(" · ")}
        </span>
        <span className="sr-only">{person.freeNow ? ", free now" : ""}</span>
      </span>
    </button>
  );
}

function PersonRow({
  person,
  team,
  selected,
  isSelf,
  onSelect,
  href,
}: {
  person: DirectoryPerson;
  team: DirectoryTeam | undefined;
  selected: boolean;
  isSelf: boolean;
  onSelect: (id: string) => void;
  /** Their profile, for the right-click menu. */
  href: string;
}) {
  const name = person.name ?? "Unnamed member";
  return (
    <button
      type="button"
      data-person-id={person.id}
      data-context-href={href}
      data-context-label={name}
      aria-pressed={selected}
      onClick={() => onSelect(person.id)}
      className={cn(
        "hover:bg-muted rounded-tile focus-glow grid min-h-12 w-full grid-cols-[auto_minmax(0,1.3fr)_minmax(0,1fr)] items-center gap-3 px-2 py-1.5 text-left text-sm outline-none md:grid-cols-[auto_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.9fr)_5.5rem_6rem]",
        selected && "bg-tint-accent hover:bg-tint-accent",
      )}
    >
      <Presence person={person} size="md" />
      <span className="min-w-0 truncate font-semibold">
        {name}
        {person.pronouns && (
          <span className="text-muted-foreground ml-1.5 text-xs font-normal">
            {person.pronouns}
          </span>
        )}
        {isSelf && <span className="text-muted-foreground ml-1 font-normal">(you)</span>}
      </span>
      <span className="text-muted-foreground min-w-0 truncate">{person.title ?? "No title"}</span>
      <span className="hidden min-w-0 md:block">
        {team ? (
          <TagChip color={`var(--chart-${((team.slot - 1) % 5) + 1})`}>{team.name}</TagChip>
        ) : (
          <span className="text-muted-foreground">Not on the chart</span>
        )}
      </span>
      <span className="text-muted-foreground hidden md:block">{ROLE_LABELS[person.role]}</span>
      <span className="text-muted-foreground figure hidden truncate md:block">
        {person.gradYear ? `Class of ${person.gradYear}` : ""}
      </span>
    </button>
  );
}

function FilterMenu({
  label,
  value,
  display,
  allLabel,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  display: string | null | undefined;
  allLabel: string;
  options: { value: string; label: string; color?: string }[];
  onChange: (value: string | null) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={chipClass(Boolean(value))}>
          {value && display ? `${label}: ${display}` : label}
          <ChevronDown aria-hidden="true" className="opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        <DropdownMenuRadioGroup value={value ?? ""} onValueChange={(v) => onChange(v || null)}>
          <DropdownMenuRadioItem value="">{allLabel}</DropdownMenuRadioItem>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>
              {o.color && (
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full"
                  style={{ background: o.color }}
                />
              )}
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SheetSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the profile" className="flex flex-col">
      <div className="bg-muted h-[88px] rounded-t-[inherit]" />
      <div className="-mt-[38px] flex flex-col gap-4 px-[22px] pb-6">
        <Skeleton className="ring-raised size-[72px] rounded-full ring-4" />
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-8 w-64 rounded-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    </div>
  );
}
