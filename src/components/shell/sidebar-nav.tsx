"use client";

import {
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CheckSquare,
  Database,
  FileText,
  ClipboardList,
  FolderOpen,
  House,
  Inbox,
  LayoutDashboard,
  Lock,
  Network,
  NotebookText,
  Pin,
  Plug,
  Ticket,
  ChevronRight,
  Users,
  Video,
  Wallet,
  X,
  type IconComponent,
} from "@/components/icons";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { unpinAction } from "@/app/app/[orgSlug]/_shell/pin-actions";
import {
  isExactPage,
  isLinkActive,
  type NavLink,
  type NavSection,
} from "@/components/shell/nav-config";
import { usePinDrop } from "@/components/pins/pin-dnd";
import { usePins } from "@/components/pins/pins-context";
import { PinButton } from "@/components/shell/pin-button";
import { useSidebarEdit } from "@/components/shell/sidebar-edit-context";
import { SidebarEditHeader, SidebarEditRows } from "@/components/shell/sidebar-edit-rows";
import { PIN_ICONS } from "@/components/shell/pin-icons";
import { fadeLabel, surfaceTone, useSidebarMode } from "@/components/shell/sidebar-mode-context";
import { arrangeSections, EMPTY_MY_SIDEBAR } from "@/lib/nav/my-sidebar";
import { canonicalHref } from "@/lib/pins/pages";
import type { PinKind } from "@/lib/pins/pages";
import { cn } from "@/lib/utils";

export interface SidebarPin {
  id: string;
  href: string;
  label: string;
  kind: PinKind;
}

export const NAV_ICONS: Record<string, IconComponent> = {
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CheckSquare,
  Database,
  ClipboardList,
  FolderOpen,
  House,
  Inbox,
  LayoutDashboard,
  Network,
  NotebookText,
  Plug,
  Ticket,
  Users,
  Video,
  Wallet,
};

/** The icons at the redesign's lighter stroke. */
export const ICON_STROKE = 1.75;

/**
 * One row of the sidebar, as the workspace plan draws it ("Option A,
 * revised"): a compact 32px row with a 16px icon 8px in, so collapsing to
 * the rail is only a change of width (a 32px square around the icon). The
 * page you're on is the whole row filled with the accent; a hover is a light
 * wash of the same accent. No outlines.
 */
export function sidebarItemClass({
  active,
  rail,
  chrome,
}: {
  active: boolean;
  rail: boolean;
  chrome: boolean;
}) {
  const tone = surfaceTone(chrome);
  return cn(
    "focus-glow relative flex h-8 shrink-0 items-center gap-2.5 overflow-hidden rounded-[7px] px-2 text-[13.5px] whitespace-nowrap outline-none",
    "[&>svg:first-child]:opacity-70",
    "[transition:width_500ms_var(--ease-ink),background-color_200ms,color_200ms] motion-reduce:[transition:none]",
    rail ? "w-8" : "w-full",
    active
      ? cn(
          "font-semibold [&>svg:first-child]:opacity-100",
          chrome
            ? "bg-chrome-accent text-chrome-accent-foreground"
            : "bg-brand-accent text-brand-accent-foreground",
        )
      : cn("font-medium", tone.text, tone.hover),
  );
}

/** The count pill's colours: dark on a plain row, the accent's text colour on the lit one. */
function countTone(active: boolean, chrome: boolean): string {
  if (!active) return "bg-foreground text-background";
  return chrome
    ? "bg-chrome-accent-foreground text-chrome-accent"
    : "bg-brand-accent-foreground text-brand-accent";
}

function NavItemLink({
  link,
  pathname,
  search,
  all,
  count = 0,
  onNavigate,
}: {
  link: NavLink;
  /** Waiting on you here (Inbox, Forms, Finance): a small number at the end. */
  count?: number;
  pathname: string;
  search: string;
  all: readonly NavLink[];
  onNavigate?: () => void;
}) {
  const { rail, chrome } = useSidebarMode();
  const isActive = isLinkActive(link, pathname, all, search);
  const Icon = NAV_ICONS[link.icon] ?? FileText;
  return (
    <Link
      href={link.href}
      onClick={onNavigate}
      aria-current={
        isExactPage(link.href, pathname, search) ? "page" : isActive ? "true" : undefined
      }
      title={link.locked ? "Not on your plan" : undefined}
      className={cn(
        sidebarItemClass({ active: isActive, rail, chrome }),
        link.locked && !isActive && "opacity-60",
      )}
    >
      <Icon className="size-4 shrink-0" strokeWidth={ICON_STROKE} aria-hidden="true" />
      <span className={cn("min-w-0 flex-1 truncate", fadeLabel(rail))}>{link.label}</span>
      {count > 0 && !link.locked && (
        <>
          <span
            className={cn(
              // A small dark pill, so what waits on you stands out; on the
              // accent row it turns to the accent's own text colour.
              "shrink-0 rounded-full px-1.5 font-mono text-[11px] leading-[18px] font-medium tabular-nums",
              countTone(isActive, chrome),
              fadeLabel(rail),
            )}
          >
            {count > 99 ? "99+" : count}
          </span>
          {/* On the rail, a dot on the icon instead of the number. */}
          {rail && (
            <span
              aria-hidden="true"
              className={cn(
                "absolute top-1.5 left-5 size-1.5 rounded-full",
                countTone(isActive, chrome),
              )}
            />
          )}
          <span className="sr-only">, {count} waiting</span>
        </>
      )}
      {link.locked && (
        <>
          <Lock className={cn("size-3.5 shrink-0", fadeLabel(rail))} aria-hidden="true" />
          <span className="sr-only"> (not on your plan)</span>
        </>
      )}
    </Link>
  );
}

/**
 * The sidebar's sections by name. The first group (Home, Inbox, People) needs
 * none: it's where you start. The rest are named for what's in them.
 */
export const SECTION_NAMES: Record<string, string> = {
  plan: "Planning",
  collect: "Data",
  money: "Money",
};

/** A section heading's box: more room above it than below, the same everywhere. */
const HEADING = "mt-5 mb-1 flex h-6 shrink-0 items-center gap-1 px-2";

/**
 * A section's name, small and quiet, with room above it; on the rail, only
 * the room. `children` sits at its right (Pinned's pin button).
 */
export function GroupLabel({ label, children }: { label: string; children?: React.ReactNode }) {
  const { rail, chrome } = useSidebarMode();
  const tone = surfaceTone(chrome);
  if (rail) return <div aria-hidden="true" className="h-4 shrink-0" />;
  return (
    <div className={cn(HEADING, "text-xs font-medium whitespace-nowrap", tone.quiet)}>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {children}
    </div>
  );
}

/**
 * A section's name that folds the section shut and open again (kept per
 * member, src/lib/nav/my-sidebar.ts). The arrow shows on hover and stays
 * while the section is shut, beside what's waiting inside it. On the rail
 * every icon shows and the heading is only room.
 */
function SectionHeader({
  id,
  label,
  collapsed,
  waiting = 0,
  children,
}: {
  id: string;
  label: string;
  collapsed: boolean;
  /** What waits on you inside, shown while it's shut. */
  waiting?: number;
  children?: React.ReactNode;
}) {
  const { rail, chrome } = useSidebarMode();
  const edit = useSidebarEdit();
  const tone = surfaceTone(chrome);
  if (rail) return <div aria-hidden="true" className="h-4 shrink-0" />;
  if (!edit) return <GroupLabel label={label}>{children}</GroupLabel>;
  return (
    <div className={cn(HEADING, "group/heading pr-1")}>
      <button
        type="button"
        onClick={() => edit.toggleGroup(id)}
        aria-expanded={!collapsed}
        aria-controls={`sidebar-section-${id}`}
        className={cn(
          "focus-glow -ml-1 flex h-6 min-w-0 items-center gap-1 rounded-md px-1 text-xs font-medium whitespace-nowrap outline-none",
          "transition-colors duration-150 motion-reduce:transition-none",
          tone.quiet,
          "hover:text-sidebar-foreground",
          chrome && "hover:text-chrome-foreground",
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronRight
          className={cn(
            "size-3 shrink-0 transition-[rotate,opacity] duration-200 motion-reduce:transition-none",
            collapsed
              ? "opacity-100"
              : "rotate-90 opacity-0 group-focus-within/heading:opacity-100 group-hover/heading:opacity-100",
          )}
          strokeWidth={2.25}
          aria-hidden="true"
        />
      </button>
      <span className="flex-1" />
      {collapsed && waiting > 0 && (
        <span
          className={cn(
            "rounded-full px-1.5 font-mono text-[11px] leading-[18px] font-medium tabular-nums",
            countTone(false, chrome),
          )}
        >
          {waiting > 99 ? "99+" : waiting}
          <span className="sr-only"> waiting</span>
        </span>
      )}
      {children}
    </div>
  );
}

/** Content that folds away on the rail (or appears only there), and can't be focused while folded. */
export function Fold({
  open,
  children,
  className,
}: {
  open: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      inert={!open}
      className={cn(
        "grid shrink-0 transition-[grid-template-rows,opacity] duration-500 ease-(--ease-ink) motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        className,
      )}
    >
      <div className="flex min-h-0 flex-col gap-0.5 overflow-hidden">{children}</div>
    </div>
  );
}

function PinnedList({
  pins,
  orgId,
  pathname,
  search,
  onNavigate,
}: {
  pins: SidebarPin[];
  orgId: string;
  pathname: string;
  search: string;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const pinsCtx = usePins();
  const edit = useSidebarEdit();
  const { rail, chrome, requestPeek } = useSidebarMode();
  const tone = surfaceTone(chrome);
  const current = pinsCtx
    ? canonicalHref(pinsCtx.orgSlug, search ? `${pathname}?${search}` : pathname)
    : pathname;
  const [pending, start] = useTransition();
  const { over, error, zone, pinProps } = usePinDrop(
    orgId,
    pins.map((p) => p.id),
  );
  const onAPin = pins.some((p) => p.href === current);
  const collapsed = !over && (edit?.my.collapsed.includes("pinned") ?? false);
  // Shut, the pin you're on still shows, so where you are never disappears.
  const shown = collapsed ? pins.filter((p) => p.href === current) : pins;
  return (
    <div
      {...zone}
      className={cn(
        "flex flex-col rounded-[12px] transition-colors",
        over && "bg-sidebar-accent/60 ring-sidebar-ring ring-1",
      )}
    >
      {/* Pinned, with the pin for the page on screen at the heading's right. */}
      <SectionHeader id="pinned" label="Pinned" collapsed={collapsed}>
        <PinButton
          iconClassName="size-3.5"
          className={cn(
            "focus-glow grid size-6 shrink-0 place-items-center rounded-md outline-none",
            "transition-colors duration-150 motion-reduce:transition-none",
            tone.quiet,
            tone.hover,
          )}
        />
      </SectionHeader>
      <Fold open={!rail}>
        {pins.length === 0 ? (
          <p className={cn("px-2 py-1.5 text-xs whitespace-nowrap", over ? tone.text : tone.quiet)}>
            {over ? "Drop to pin" : "Pin a page to keep it here"}
          </p>
        ) : (
          <ul id="sidebar-section-pinned" className="flex flex-col gap-0.5">
            {shown.map((pin) => {
              const Icon = PIN_ICONS[pin.kind] ?? FileText;
              const active = current === pin.href;
              return (
                <li key={pin.id} className="group relative" {...pinProps(pin.id)}>
                  <Link
                    href={pin.href}
                    onClick={onNavigate}
                    draggable={false}
                    aria-current={active ? "page" : undefined}
                    className={cn(sidebarItemClass({ active, rail: false, chrome }), "pr-8")}
                  >
                    <Icon
                      className="size-4 shrink-0"
                      strokeWidth={ICON_STROKE}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate">{pin.label}</span>
                  </Link>
                  <button
                    type="button"
                    disabled={pending}
                    aria-label={`Unpin ${pin.label}`}
                    onClick={() =>
                      start(async () => {
                        await unpinAction(orgId, pin.id);
                        router.refresh();
                      })
                    }
                    className={cn(
                      "focus-glow absolute top-1/2 right-1 grid size-6 -translate-y-1/2 place-items-center rounded-md opacity-0 outline-none group-hover:opacity-100 focus-visible:opacity-100",
                      active
                        ? chrome
                          ? "text-chrome-accent-foreground hover:bg-chrome-accent-foreground/15"
                          : "text-brand-accent-foreground hover:bg-brand-accent-foreground/15"
                        : tone.hover,
                    )}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
            {over && (
              <li
                className={cn(
                  "mx-1 rounded-full border border-dashed px-3 py-1.5 text-xs",
                  tone.text,
                )}
              >
                Drop to pin
              </li>
            )}
          </ul>
        )}
      </Fold>
      {/* On the rail, the pins fold into one item that opens the peek. A
          pointer's way in: keyboard focus anywhere on the rail already opens
          the peek, where this folds away again (so it takes no Tab stop). */}
      <Fold open={rail}>
        <button
          type="button"
          onClick={requestPeek}
          tabIndex={-1}
          aria-hidden="true"
          title="Pinned"
          className={sidebarItemClass({ active: onAPin, rail: true, chrome })}
        >
          <Pin className="size-5 shrink-0" strokeWidth={ICON_STROKE} aria-hidden="true" />
        </button>
      </Fold>
      {error && <p className="text-destructive px-2 pt-1 text-xs">{error}</p>}
    </div>
  );
}

export function SidebarNav({
  sections,
  orgId,
  pins = [],
  counts = {},
  tools,
  spaces,
  onNavigate,
}: {
  sections: NavSection[];
  orgId: string;
  pins?: SidebarPin[];
  /** Small counts beside entries, by section id (Inbox, Forms, Finance). */
  counts?: Record<string, number>;
  /** Search and New, above the sections (SidebarTools). */
  tools?: React.ReactNode;
  /** Kept for callers; the club switcher at the foot of the sidebar lists the spaces now. */
  spaces?: React.ReactNode;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const { rail } = useSidebarMode();
  const all = sections.flatMap((s) => s.items);
  // Your own order and hidden rows (Edit sidebar), on top of the organization's.
  const edit = useSidebarEdit();
  const editing = Boolean(edit?.editing) && !rail;
  const arranged = arrangeSections(sections, edit?.my ?? EMPTY_MY_SIDEBAR, {
    keepHidden: editing,
  });

  return (
    <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col">
      {editing ? <SidebarEditHeader /> : tools}
      <div
        className={cn(
          "-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto px-1 pb-3",
          rail && "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        {editing && <SidebarEditRows sections={arranged} />}
        {!editing &&
          arranged.map((section) => {
            const name = section.label ?? SECTION_NAMES[section.id];
            const row = (link: NavLink) => (
              <NavItemLink
                key={link.id}
                link={link}
                pathname={pathname}
                search={search}
                all={all}
                count={counts[link.id] ?? 0}
                onNavigate={onNavigate}
              />
            );
            if (!name) {
              return (
                <div key={section.id} className="flex flex-col gap-0.5">
                  {section.items.map(row)}
                </div>
              );
            }
            const collapsed = !rail && (edit?.my.collapsed.includes(section.id) ?? false);
            // Shut, the page you're on still shows under the heading.
            const here = section.items.filter((l) => isLinkActive(l, pathname, all, search));
            return (
              <div key={section.id} className="flex flex-col">
                <SectionHeader
                  id={section.id}
                  label={name}
                  collapsed={collapsed}
                  waiting={section.items.reduce((sum, l) => sum + (counts[l.id] ?? 0), 0)}
                />
                <Fold open={!collapsed}>
                  <div id={`sidebar-section-${section.id}`} className="flex flex-col gap-0.5">
                    {section.items.map(row)}
                  </div>
                </Fold>
                {collapsed && here.length > 0 && (
                  <div className="flex flex-col gap-0.5">{here.map(row)}</div>
                )}
              </div>
            );
          })}
        {!editing && (
          <PinnedList
            pins={pins}
            orgId={orgId}
            pathname={pathname}
            search={search}
            onNavigate={onNavigate}
          />
        )}
      </div>
      {/* Personal and the clubs: at the foot of the sidebar, never pushed
          under the pins (they scroll on their own when there are many). */}
      {spaces && (
        <Fold open={!rail} className="mt-1 shrink-0 pt-2">
          <div className="max-h-[40vh] overflow-y-auto">{spaces}</div>
        </Fold>
      )}
    </nav>
  );
}
