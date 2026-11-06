"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";

import { discardDraftAction } from "@/app/app/[orgSlug]/org-chart/actions";
import { useMediaQuery } from "@/components/calendar/hooks";
import { Check, Plus, Search, X } from "@/components/icons";
import type { EditorMember } from "@/components/org-chart/editor/member-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { UserAvatar } from "@/components/user-avatar";
import { addPosition, removePosition, type DraftPosition } from "@/lib/org-chart/draft";
import { normalizeName } from "@/lib/org-chart/match";
import { outlineOrder } from "@/lib/org-chart/outline";
import {
  isFilled,
  nextEmptySeat,
  searchMembers,
  seatOrder,
  seatSuggestions,
  withOpenSeats,
} from "@/lib/org-chart/quick";
import type { NamedTeam } from "@/lib/org-chart/teams";
import type { OpenItem } from "@/lib/org-chart/types";
import { cn } from "@/lib/utils";

import { useDraftSaver } from "./use-draft-saver";

/**
 * "Start from a shape": the shape's seats as a small tree (an indented
 * list on a phone). Each empty seat takes a typed name (member
 * autocomplete, which leaves out anyone already seated; Enter fills it and
 * moves to the next empty seat), a one-tap confirm of the member whose own
 * title fits the seat, or a member tapped in from the list beside it
 * (dragging works too, on a desktop). Titles rename in place. Nothing is
 * saved until something changes; a seat left empty is marked an open role
 * at Publish. It all saves into an ordinary draft and publishes with the
 * normal publish.
 */

const MEMBER_TYPE = "application/x-bananasplit-member";

/** Below Tailwind's sm breakpoint the seats are a list, not a tree. */
const NARROW = "(max-width: 39.99rem)";

type Option =
  { kind: "member"; member: EditorMember } | { kind: "name"; name: string } | { kind: "open" };

function filled(p: DraftPosition, member: EditorMember): DraftPosition {
  return {
    ...p,
    userId: member.id,
    personName: member.name,
    matchState: "CONFIRMED",
    matchScore: 1,
    suggestedUserIds: [],
    isOpen: false,
  };
}

function named(p: DraftPosition, name: string): DraftPosition {
  return {
    ...p,
    userId: null,
    personName: name,
    matchState: "UNMATCHED",
    matchScore: null,
    suggestedUserIds: [],
    isOpen: false,
  };
}

function cleared(p: DraftPosition): DraftPosition {
  return {
    ...p,
    userId: null,
    personName: null,
    matchState: "UNMATCHED",
    matchScore: null,
    suggestedUserIds: [],
    isOpen: true,
  };
}

export function SeatsScreen({
  orgId,
  orgSlug,
  version,
  positions: given,
  members,
  canSetTitles,
}: {
  orgId: string;
  orgSlug: string;
  version: {
    id: string;
    number: number;
    editVersion: number;
    openItems: OpenItem[];
    teams: NamedTeam[];
  };
  positions: DraftPosition[];
  members: EditorMember[];
  canSetTitles: boolean;
}) {
  const router = useRouter();
  const listId = useId();
  const narrow = useMediaQuery(NARROW);
  const [confirmEl, confirm] = useConfirm();
  const [pending, startTransition] = useTransition();
  const [publishing, startPublish] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [setTitles, setSetTitles] = useState(true);
  /** Published with a change that came in too late: stay, say so, edit nothing more. */
  const [published, setPublished] = useState(false);
  const locked = pending || publishing || published;

  const [activeId, setActiveId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [skip, setSkip] = useState<ReadonlySet<string>>(new Set());
  const [find, setFind] = useState("");
  const [focusTarget, setFocusTarget] = useState<{ id: string; n: number } | null>(null);
  const inputs = useRef(new Map<string, HTMLInputElement>());

  const onRemap = (ids: Record<string, string>) => {
    const remap = (id: string | null) => (id && ids[id] ? ids[id] : id);
    setActiveId(remap);
    setFocusedId(remap);
    setDropOn(remap);
    setRenaming((r) => (r ? { ...r, id: remap(r.id) as string } : r));
    setFocusTarget((t) => (t ? { ...t, id: remap(t.id) as string } : t));
  };
  const { positions, change, pause, publish, error, keyOf } = useDraftSaver({
    orgId,
    version,
    initial: given,
    onRemap,
  });

  // Moves focus once per request (a save swapping ids must not pull it back).
  const focusedRequest = useRef(0);
  useEffect(() => {
    if (!focusTarget || focusTarget.n === focusedRequest.current) return;
    focusedRequest.current = focusTarget.n;
    inputs.current.get(keyOf(focusTarget.id))?.focus();
  }, [focusTarget, keyOf]);

  const membersById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const seated = useMemo(
    () => new Set(positions.map((p) => p.userId).filter((id): id is string => Boolean(id))),
    [positions],
  );
  const suggestions = useMemo(
    () => seatSuggestions(positions, members, skip),
    [positions, members, skip],
  );
  const children = useMemo(() => {
    const map = new Map<string | null, DraftPosition[]>();
    const ids = new Set(positions.map((p) => p.id));
    for (const p of seatOrder(positions)) {
      const parent = p.reportsTo && ids.has(p.reportsTo) ? p.reportsTo : null;
      map.set(parent, [...(map.get(parent) ?? []), p]);
    }
    return map;
  }, [positions]);
  const outline = useMemo(() => outlineOrder(positions), [positions]);
  const unseated = members.filter((m) => !seated.has(m.id));
  const listed = find.trim()
    ? unseated.filter((m) => normalizeName(m.name ?? "").includes(normalizeName(find)))
    : unseated;
  const top = children.get(null)?.[0] ?? null;

  const optionsFor = (q: string): Option[] => {
    const text = q.trim();
    if (!text) return [];
    // Anyone already in a seat is left out, so nobody lands in two by accident.
    const found = searchMembers(text, members, seated, 5);
    const out: Option[] = found.map((member) => ({ kind: "member", member }));
    if (found.length === 0) out.push({ kind: "name", name: text });
    out.push({ kind: "open" });
    return out;
  };

  const goNext = (fromId: string, positionsNow: DraftPosition[]) => {
    const next = nextEmptySeat(positionsNow, fromId);
    setQuery("");
    setHighlight(0);
    if (next) {
      setActiveId(next.id);
      setFocusTarget((t) => ({ id: next.id, n: (t?.n ?? 0) + 1 }));
    } else {
      inputs.current.get(keyOf(fromId))?.blur();
    }
  };

  const fill = (seatId: string, update: (p: DraftPosition) => DraftPosition, moveOn = true) => {
    if (locked) return;
    let after: DraftPosition[] = [];
    change((current) => {
      after = current.map((p) => (p.id === seatId ? update(p) : p));
      return after;
    });
    if (moveOn) goNext(seatId, after);
  };

  const pick = (seatId: string, option: Option) => {
    if (locked) return;
    if (option.kind === "member") fill(seatId, (p) => filled(p, option.member));
    else if (option.kind === "name") fill(seatId, (p) => named(p, option.name));
    else goNext(seatId, positions);
  };

  /** Where a tapped member goes: the seat last worked on, else the first empty one. */
  const seatForClick = () => {
    const active = activeId ? positions.find((p) => p.id === activeId) : undefined;
    if (active && !isFilled(active)) return active.id;
    return nextEmptySeat(positions, null)?.id ?? null;
  };

  const commitRename = () => {
    if (!renaming) return;
    const title = renaming.title.trim();
    if (title)
      change((current) => current.map((p) => (p.id === renaming.id ? { ...p, title } : p)));
    setRenaming(null);
  };

  const addSeat = () => {
    if (locked) return;
    const id = `new-seat-${Date.now().toString(36)}`;
    change((current) =>
      addPosition(current, top?.id ?? null, id).map((p) =>
        p.id === id ? { ...p, title: "New seat", isOpen: true } : p,
      ),
    );
    setRenaming({ id, title: "New seat" });
  };

  /** Throws the draft away and goes back to the ways to start; an error message if it can't. */
  const discard = async (): Promise<string | undefined> => {
    const result = await discardDraftAction(orgId, version.id);
    if (!result.ok) return "error" in result ? result.error : "The draft couldn't be discarded.";
    router.push(`/app/${orgSlug}/people?view=chart`);
    router.refresh();
  };

  const onStartOver = async () => {
    setStatus(null);
    // No save may land on a draft that's being thrown away.
    const resume = pause();
    if (positions.some(isFilled)) {
      const confirmed = await confirm({
        title: "Start over?",
        description: "The seats you filled are cleared.",
        confirmLabel: "Start over",
        run: discard,
      });
      if (!confirmed) resume();
      return;
    }
    startTransition(async () => {
      const failed = await discard();
      if (failed) {
        setStatus(failed);
        resume();
      }
    });
  };

  const onPublish = () =>
    startPublish(async () => {
      setStatus(null);
      // An empty seat publishes as an open role (saved only if that changes anything).
      change(withOpenSeats);
      const result = await publish(canSetTitles && setTitles);
      if (!result.ok) {
        setStatus(result.error);
        return;
      }
      toast({ title: "Org chart published" });
      if (result.unsaved) {
        setPublished(true);
        setStatus(
          "Published. Your last change came in after publishing, so it isn't on the chart. Make it again with Edit chart.",
        );
        return;
      }
      router.push(`/app/${orgSlug}/people?view=chart`);
      router.refresh();
    });

  const renderSeat = (p: DraftPosition, wide = false) => {
    const k = keyOf(p.id);
    const member = p.userId ? membersById.get(p.userId) : undefined;
    const isFull = isFilled(p);
    const suggestion = !isFull ? membersById.get(suggestions.get(p.id) ?? "") : undefined;
    const focused = focusedId === p.id;
    const options = focused && !locked ? optionsFor(query) : [];
    const open = focused && options.length > 0;
    const optionId = (i: number) => `${listId}-${k}-${i}`;

    return (
      <div
        onDragOver={(e) => {
          if (locked || !e.dataTransfer.types.includes(MEMBER_TYPE)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDropOn(p.id);
        }}
        onDragLeave={() => setDropOn((d) => (d === p.id ? null : d))}
        onDrop={(e) => {
          const m = membersById.get(e.dataTransfer.getData(MEMBER_TYPE));
          setDropOn(null);
          if (!m) return;
          e.preventDefault();
          fill(p.id, (x) => filled(x, m), false);
        }}
        className={cn(
          "relative flex flex-col gap-2 rounded-2xl p-3 text-left",
          wide ? "w-full" : "w-[200px]",
          isFull ? "bg-card edge" : "bg-card/60 border-foreground/25 border-[1.5px] border-dashed",
          (activeId === p.id && !isFull) || dropOn === p.id
            ? "outline-primary border-transparent outline-2"
            : "",
        )}
      >
        <div className="flex items-start gap-1">
          {renaming?.id === p.id ? (
            <Input
              autoFocus
              aria-label="Seat title"
              value={renaming.title}
              className="h-10 md:text-[13.5px]"
              onChange={(e) => setRenaming({ id: p.id, title: e.target.value })}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitRename();
                } else if (e.key === "Escape") setRenaming(null);
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setRenaming({ id: p.id, title: p.title })}
              className="focus-visible:outline-foreground min-w-0 flex-1 rounded-md py-0.5 text-left text-[13.5px] font-semibold break-words outline-none hover:underline focus-visible:outline-2"
            >
              {p.title || "Untitled seat"}
            </button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            // A 40px target that doesn't make the seat taller.
            className="-my-2 -mr-2 shrink-0"
            aria-label={isFull ? `Empty the ${p.title} seat` : `Remove the ${p.title} seat`}
            onClick={() => {
              if (locked) return;
              if (isFull) {
                if (p.userId) setSkip((s) => new Set([...s, `${p.id}:${p.userId}`]));
                fill(p.id, cleared, false);
              } else change((current) => removePosition(current, p.id));
            }}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>

        {isFull ? (
          <span className="flex min-w-0 items-center gap-2">
            {member && <UserAvatar user={member} size="sm" className="shrink-0" />}
            <span className="text-muted-foreground truncate text-[12.5px]">
              {member?.name ?? p.personName}
            </span>
          </span>
        ) : (
          <>
            {suggestion && (
              <span className="flex items-center gap-2 text-[13px]">
                <UserAvatar user={suggestion} size="xs" className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{suggestion.name}?</span>
                <Button
                  type="button"
                  size="icon"
                  className="-my-1 shrink-0"
                  aria-label={`Yes, ${suggestion.name ?? "this member"}`}
                  onClick={() => fill(p.id, (x) => filled(x, suggestion))}
                >
                  <Check aria-hidden="true" />
                </Button>
              </span>
            )}
            <div className="relative">
              <input
                ref={(el) => {
                  if (el) inputs.current.set(k, el);
                  else inputs.current.delete(k);
                }}
                role="combobox"
                aria-label={`Who is ${p.title}`}
                aria-expanded={open}
                aria-controls={open ? `${listId}-${k}` : undefined}
                aria-activedescendant={open ? optionId(highlight) : undefined}
                aria-autocomplete="list"
                placeholder="Type a name"
                value={focused ? query : ""}
                onFocus={() => {
                  setFocusedId(p.id);
                  setActiveId(p.id);
                  setQuery("");
                  setHighlight(0);
                }}
                onBlur={() => setFocusedId((f) => (f === p.id ? null : f))}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHighlight(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown" && open) {
                    e.preventDefault();
                    setHighlight((h) => (h + 1) % options.length);
                  } else if (e.key === "ArrowUp" && open) {
                    e.preventDefault();
                    setHighlight((h) => (h - 1 + options.length) % options.length);
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    if (open) pick(p.id, options[Math.min(highlight, options.length - 1)]);
                    else goNext(p.id, positions);
                  } else if (e.key === "Escape") {
                    setQuery("");
                  }
                }}
                className="border-input bg-card focus-visible:border-foreground focus-glow h-10 w-full rounded-[10px] border px-2.5 text-base outline-none disabled:opacity-60 md:text-[13.5px]"
              />
              {open && (
                <div
                  id={`${listId}-${k}`}
                  role="listbox"
                  aria-label="Members"
                  className="bg-card absolute top-full right-0 left-0 z-20 mt-1.5 flex flex-col gap-0.5 rounded-[14px] p-1.5 shadow-lg"
                >
                  {options.map((o, i) => (
                    <div
                      key={o.kind === "member" ? o.member.id : o.kind}
                      id={optionId(i)}
                      role="option"
                      aria-selected={i === highlight}
                      // Keep the input focused: a click picks, it doesn't blur.
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => pick(p.id, o)}
                      className={cn(
                        "flex min-h-10 cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13.5px]",
                        i === highlight && "bg-muted",
                        o.kind !== "member" && "text-muted-foreground text-[13px]",
                      )}
                    >
                      {o.kind === "member" ? (
                        <>
                          <UserAvatar user={o.member} size="sm" className="shrink-0" />
                          <b className="truncate font-semibold">{o.member.name}</b>
                        </>
                      ) : o.kind === "name" ? (
                        <>Use &ldquo;{o.name}&rdquo;</>
                      ) : (
                        "Leave it open for now"
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  };

  /** The phone layout: every seat full width, indented under its manager. */
  const renderList = () => (
    <ul className="flex flex-col gap-2.5">
      {outline.map(({ position: p, depth }) => (
        <li
          key={keyOf(p.id)}
          style={depth > 0 ? { marginLeft: `${(Math.min(depth, 3) - 1) * 14 + 4}px` } : undefined}
          className={cn(depth > 0 && "border-muted-strong border-l-2 pl-2.5")}
        >
          {renderSeat(p, true)}
        </li>
      ))}
    </ul>
  );

  const renderBranch = (parentId: string | null): React.ReactNode => {
    const list = children.get(parentId) ?? [];
    if (list.length === 0) return null;
    return (
      <ul className={cn("flex justify-center", parentId !== null && "pt-5")}>
        {list.map((p) => (
          <li
            key={keyOf(p.id)}
            className={cn(
              "relative flex flex-col items-center px-2.5",
              parentId !== null &&
                "before:bg-muted-strong after:bg-muted-strong pt-5 before:absolute before:top-0 before:left-1/2 before:h-5 before:w-0.5 before:-translate-x-1/2 after:absolute after:top-0 after:right-0 after:left-0 after:h-0.5 first:after:left-1/2 last:after:right-1/2 only:after:hidden",
              parentId === null && "pb-6",
            )}
          >
            {renderSeat(p)}
            {(children.get(p.id)?.length ?? 0) > 0 && (
              <>
                <span aria-hidden="true" className="bg-muted-strong h-5 w-0.5" />
                {renderBranch(p.id)}
              </>
            )}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="space-y-6">
      {confirmEl}
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="page-title flex-1">Org chart</h1>
        <Badge variant="accent">Draft</Badge>
        {published ? (
          <Button type="button" onClick={() => router.push(`/app/${orgSlug}/people?view=chart`)}>
            Go to the chart
          </Button>
        ) : (
          <>
            <Button type="button" variant="ghost" disabled={locked} onClick={onStartOver}>
              Start over
            </Button>
            {canSetTitles && (
              <span className="flex items-center gap-2 px-1">
                <Checkbox
                  id="seats-set-titles"
                  checked={setTitles}
                  disabled={locked}
                  onCheckedChange={(v) => setSetTitles(v === true)}
                />
                <Label htmlFor="seats-set-titles" className="text-sm font-normal">
                  Update members&apos; titles
                </Label>
              </span>
            )}
            <Button type="button" disabled={locked || positions.length === 0} onClick={onPublish}>
              {publishing ? "Publishing…" : "Publish"}
            </Button>
          </>
        )}
      </header>

      <p className="display-title max-w-[44ch] text-2xl">
        Fill the seats. Type a name, or tap someone in the list to put them in the next empty seat.
      </p>

      {(status || error) && (
        <p role="alert" className="text-destructive text-sm">
          {status ?? error}
        </p>
      )}

      <fieldset disabled={locked} className="flex min-w-0 flex-wrap items-start gap-5">
        <section
          aria-label="Seats"
          className="bg-card edge rounded-card flex min-w-0 flex-[999_1_640px] flex-col overflow-hidden"
        >
          <div
            className={cn(
              "bg-[radial-gradient(color-mix(in_oklab,var(--foreground)_12%,transparent)_1px,transparent_1.2px)] bg-[length:20px_20px]",
              narrow ? "px-3 py-4" : "overflow-x-auto px-4 py-8",
            )}
          >
            <div className={cn("flex flex-col", narrow ? "gap-2.5" : "mx-auto w-max items-center")}>
              {narrow ? renderList() : renderBranch(null)}
              <button
                type="button"
                onClick={addSeat}
                className={cn(
                  "border-foreground/20 text-muted-foreground hover:bg-muted/50 focus-visible:outline-foreground flex h-12 items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed text-[13px] font-semibold outline-none focus-visible:outline-2",
                  narrow ? "w-full" : "mt-2 w-[200px]",
                )}
              >
                <Plus className="size-3.5" aria-hidden="true" />
                Add a seat
              </button>
            </div>
          </div>
          <p className="text-muted-foreground px-5 pt-1 pb-4 text-[12.5px]">
            Tap a seat&apos;s title to rename it. Empty seats show as open roles.
          </p>
        </section>

        <aside
          aria-labelledby="seat-members"
          className="bg-card edge rounded-card flex min-w-0 flex-[1_1_300px] flex-col gap-3 p-5"
        >
          <div className="flex items-center gap-2">
            <h2 id="seat-members" className="heading flex-1 text-[15px]">
              Members
            </h2>
            <span className="text-muted-foreground text-[12.5px]">
              {unseated.length} not seated
            </span>
          </div>
          <label className="relative block">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              aria-label="Find a member"
              placeholder="Find someone"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              className="rounded-full pl-9"
            />
          </label>
          <ul className="-m-1 flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto p-1">
            {listed.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  draggable={!locked}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(MEMBER_TYPE, m.id);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => {
                    const seatId = seatForClick();
                    if (seatId) fill(seatId, (p) => filled(p, m));
                  }}
                  className="bg-card hover:bg-muted/50 focus-visible:outline-foreground flex min-h-10 w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13.5px] shadow-[0_0_0_1px_var(--border)] outline-none focus-visible:outline-2"
                >
                  <UserAvatar user={m} size="sm" className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{m.name ?? "Unnamed member"}</span>
                  {m.title && (
                    <span className="text-muted-foreground max-w-[45%] truncate text-xs">
                      {m.title}
                    </span>
                  )}
                </button>
              </li>
            ))}
            {listed.length === 0 && (
              <li className="text-muted-foreground text-sm">
                {unseated.length === 0 ? "Everyone has a seat." : "Nobody by that name."}
              </li>
            )}
          </ul>
        </aside>
      </fieldset>
    </div>
  );
}
