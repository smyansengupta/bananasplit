"use client";

import { Check, FileText, Loader2, Pin } from "@/components/icons";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState, useTransition } from "react";

import { searchPinnablesAction, togglePinAction } from "@/app/app/[orgSlug]/_shell/pin-actions";
import { PIN_ICONS, PIN_KIND_LABELS } from "@/components/shell/pin-icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SearchField } from "@/components/ui/search-field";
import { chipClass } from "@/components/ui/segmented";
import type { PinKind } from "@/lib/pins/pages";
import { cn } from "@/lib/utils";

/**
 * Pins, app-wide: which addresses the member has pinned in this org, a
 * toggle any component can drop in (<PinToggle href label />), and the
 * "Pin something" picker that searches everything pinnable.
 */

interface PinsValue {
  orgId: string;
  orgSlug: string;
  pinned: ReadonlySet<string>;
  openPicker: () => void;
}

const PinsContext = createContext<PinsValue | null>(null);

export function usePins(): PinsValue | null {
  return useContext(PinsContext);
}

interface PinnableItem {
  href: string;
  label: string;
  kind: PinKind;
  detail?: string;
}

interface PinnableGroup {
  id: string;
  label: string;
  items: PinnableItem[];
}

export function PinsProvider({
  orgId,
  orgSlug,
  pinnedHrefs,
  children,
}: {
  orgId: string;
  orgSlug: string;
  pinnedHrefs: readonly string[];
  children: React.ReactNode;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pinned = useMemo(() => new Set(pinnedHrefs), [pinnedHrefs]);
  const value = useMemo(
    () => ({ orgId, orgSlug, pinned, openPicker: () => setPickerOpen(true) }),
    [orgId, orgSlug, pinned],
  );
  return (
    <PinsContext.Provider value={value}>
      {children}
      <PinPicker open={pickerOpen} onOpenChange={setPickerOpen} />
    </PinsContext.Provider>
  );
}

/** Pins or unpins `href`, keeping an optimistic state until the refresh lands. */
function usePinToggle(href: string) {
  const ctx = usePins();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const saved = ctx?.pinned.has(href) ?? false;
  const [lastSaved, setLastSaved] = useState(saved);
  if (saved !== lastSaved) {
    setLastSaved(saved);
    setOptimistic(null);
  }
  const on = optimistic ?? saved;
  function toggle() {
    if (!ctx) return;
    setOptimistic(!on);
    start(async () => {
      const result = await togglePinAction(ctx.orgId, href);
      if (!result.ok) setOptimistic(null);
      router.refresh();
    });
  }
  return { on, pending, toggle, ready: Boolean(ctx) };
}

/**
 * A small pin toggle for cards and rows. It may sit inside a link or a
 * clickable row, so it stops the click from reaching them.
 */
export function PinToggle({
  href,
  path,
  label,
  className,
}: {
  /** The full in-app address... */
  href?: string;
  /** ...or the path inside the org ("/tasks/abc"). */
  path?: string;
  label: string;
  className?: string;
}) {
  const ctx = usePins();
  const target = href ?? (ctx && path ? `/app/${ctx.orgSlug}${path}` : "");
  const { on, pending, toggle, ready } = usePinToggle(target);
  if (!ready || !target) return null;
  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={on}
      aria-label={on ? `Unpin ${label}` : `Pin ${label}`}
      title={on ? "Unpin" : "Pin to your sidebar and Overview"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        "bg-background/90 hover:bg-muted text-muted-foreground hover:text-foreground focus-visible:outline-foreground grid size-8 shrink-0 place-items-center rounded-full transition-[opacity,background-color,transform] outline-none focus-visible:outline-2 active:scale-[0.94]",
        className,
        // A pinned item always shows its pin, even where the toggle only appears on hover.
        on && "text-foreground opacity-100",
      )}
    >
      <Pin className={cn("size-3.5", on && "fill-current")} aria-hidden="true" />
    </button>
  );
}

function PickerRow({ item }: { item: PinnableItem }) {
  const { on, pending, toggle } = usePinToggle(item.href);
  const Icon = PIN_ICONS[item.kind] ?? FileText;
  return (
    <li>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={on}
        className={cn(
          "hover:bg-muted/60 rounded-field focus-visible:outline-foreground flex w-full items-center gap-3 px-2.5 py-2 text-left transition-colors outline-none focus-visible:outline-2",
          on && "bg-[color-mix(in_oklab,var(--glow)_14%,transparent)]",
        )}
      >
        <span className="bg-card ring-foreground/6 grid size-9 shrink-0 place-items-center rounded-full shadow-[var(--edge-highlight)] ring-1">
          <Icon className="size-[18px]" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{item.label}</span>
          <span className="text-muted-foreground block truncate text-[13px]">
            {PIN_KIND_LABELS[item.kind]}
            {item.detail ? ` · ${item.detail}` : ""}
          </span>
        </span>
        <span
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold",
            on ? "bg-primary text-primary-foreground" : "border-input text-foreground border",
          )}
        >
          {on ? (
            <Check className="size-3.5" aria-hidden="true" />
          ) : (
            <Pin className="size-3.5" aria-hidden="true" />
          )}
          {on ? "Pinned" : "Pin"}
        </span>
      </button>
    </li>
  );
}

/** "Pin something": search notes, files, folders, tasks, events, people, pages... and pin any of them. */
function PinPicker({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const orgId = usePins()?.orgId ?? null;
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<PinnableGroup[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    if (!open || !orgId) return;
    let live = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const result = await searchPinnablesAction(orgId, query);
        if (live) setGroups(result);
      } finally {
        if (live) setLoading(false);
      }
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [open, query, orgId]);

  const shown = (groups ?? []).filter((g) => filter === "all" || g.id === filter);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setQuery("");
          setFilter("all");
        }
      }}
    >
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pin className="size-4" aria-hidden="true" />
            Pin something
          </DialogTitle>
          <DialogDescription>
            Notes, files, folders, tasks, events, people, databases or any page. Pins show in your
            sidebar and on your Overview.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <SearchField
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Search everything"
            aria-label="Search everything you can pin"
            className="sm:w-full"
          />
          {loading && (
            <Loader2
              className="text-muted-foreground absolute top-1/2 right-8 size-4 -translate-y-1/2 animate-spin"
              aria-hidden="true"
            />
          )}
        </div>
        {groups && groups.length > 0 && (
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
            {[{ id: "all", label: "All" }, ...groups].map((g) => (
              <button
                key={g.id}
                type="button"
                aria-pressed={filter === g.id}
                onClick={() => setFilter(g.id)}
                className={chipClass(filter === g.id)}
              >
                {g.label}
              </button>
            ))}
          </div>
        )}
        <div className="-mx-2 min-h-40 flex-1 overflow-y-auto px-2">
          {groups === null ? (
            <p className="text-muted-foreground py-8 text-center text-sm">Loading…</p>
          ) : shown.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              Nothing matches “{query}”.
            </p>
          ) : (
            shown.map((g) => (
              <section key={g.id} className="mb-3">
                <h3 className="eyebrow text-muted-foreground px-2.5 pb-1">{g.label}</h3>
                <ul className="space-y-0.5">
                  {g.items.map((item) => (
                    <PickerRow key={item.href} item={item} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
