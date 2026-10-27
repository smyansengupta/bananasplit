"use client";

import {
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CheckSquare,
  Database,
  FileText,
  FolderOpen,
  House,
  LayoutDashboard,
  Lock,
  Network,
  NotebookText,
  Pin,
  Plus,
  Ticket,
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
import { PIN_ICONS } from "@/components/shell/pin-icons";
import { fadeLabel, surfaceTone, useSidebarMode } from "@/components/shell/sidebar-mode-context";
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
  FolderOpen,
  House,
  LayoutDashboard,
  Network,
  NotebookText,
  Ticket,
  Users,
  Video,
  Wallet,
};

/** The icons at the redesign's lighter stroke. */
export const ICON_STROKE = 1.75;

/**
 * One row of the sidebar: a 40px pill with the icon 10px in, so collapsing
 * to the rail is only a change of width (40px, a circle around the icon).
 * The page you're on is the accent pill with the glow under it.
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
    "focus-glow relative flex h-10 shrink-0 items-center gap-3 overflow-hidden rounded-full pr-3 pl-2.5 text-sm font-medium whitespace-nowrap outline-none",
    // Width animates (the rail collapsing) and so does the halo. The pill
    // itself lands at once: cross-fading it left a beat on a slow page where
    // the row you came from still looked selected and the one you picked
    // didn't, which reads as the highlight bouncing between two rows.
    "[transition:width_500ms_var(--ease-ink),box-shadow_200ms] motion-reduce:[transition:none]",
    rail ? "w-10" : "w-full",
    active
      ? chrome
        ? "bg-chrome-accent text-chrome-accent-foreground glow-halo font-semibold"
        : "bg-brand-accent text-brand-accent-foreground glow-halo font-semibold"
      : cn(tone.text, tone.hover),
  );
}

function NavItemLink({
  link,
  pathname,
  search,
  all,
  onNavigate,
}: {
  link: NavLink;
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
      <Icon className="size-5 shrink-0" strokeWidth={ICON_STROKE} aria-hidden="true" />
      <span className={cn("min-w-0 flex-1 truncate", fadeLabel(rail))}>{link.label}</span>
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
 * A group's name in sentence case; on the rail, a short hairline instead.
 * `children` sits at the right of the row (Pinned's +).
 */
export function GroupLabel({ label, children }: { label: string; children?: React.ReactNode }) {
  const { rail, chrome } = useSidebarMode();
  const tone = surfaceTone(chrome);
  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-between overflow-hidden text-[13px] font-medium whitespace-nowrap",
        "transition-[height,padding] duration-500 ease-(--ease-ink) motion-reduce:transition-none",
        rail ? "h-3.5 p-0" : "h-[34px] pt-3 pr-1 pl-3",
        tone.quiet,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-1/2 left-2 h-px w-6 transition-opacity duration-200 motion-reduce:transition-none",
          tone.line,
          rail ? "opacity-100" : "opacity-0",
        )}
      />
      <span className={fadeLabel(rail)}>{label}</span>
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
  return (
    <div
      {...zone}
      className={cn(
        "flex flex-col rounded-[22px] transition-colors",
        over && "bg-sidebar-accent/60 ring-sidebar-ring ring-1",
      )}
    >
      <GroupLabel label="Pinned">
        {pinsCtx && (
          <button
            type="button"
            onClick={() => pinsCtx.openPicker()}
            aria-label="Pin something"
            title="Pin something"
            tabIndex={rail ? -1 : undefined}
            aria-hidden={rail || undefined}
            className={cn(
              "focus-glow grid size-[26px] place-items-center rounded-full outline-none",
              "transition-opacity duration-200 motion-reduce:transition-none",
              tone.hover,
              rail && "pointer-events-none opacity-0",
            )}
          >
            <Plus className="size-4" aria-hidden="true" />
          </button>
        )}
      </GroupLabel>
      <Fold open={!rail}>
        {pins.length === 0 ? (
          <p
            title="Drag a page here, or press the pin at the top of any page."
            className={cn(
              "px-3 py-1 text-xs whitespace-nowrap",
              tone.quiet,
              over && "text-sidebar-foreground",
            )}
          >
            {over ? "Drop to pin" : "Nothing pinned yet"}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {pins.map((pin) => {
              const Icon = PIN_ICONS[pin.kind] ?? FileText;
              const active = current === pin.href;
              return (
                <li key={pin.id} className="group relative" {...pinProps(pin.id)}>
                  <Link
                    href={pin.href}
                    onClick={onNavigate}
                    draggable={false}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      sidebarItemClass({ active, rail: false, chrome }),
                      "pr-9",
                      !active && "font-normal",
                    )}
                  >
                    <Icon
                      className="size-5 shrink-0 opacity-80"
                      strokeWidth={ICON_STROKE}
                      aria-hidden="true"
                    />
                    <span className="truncate">{pin.label}</span>
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
                      "focus-glow absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-full opacity-0 outline-none group-hover:opacity-100 focus-visible:opacity-100",
                      active ? "text-brand-accent-foreground" : tone.hover,
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
      {error && <p className="text-destructive px-3 pt-1 text-xs">{error}</p>}
    </div>
  );
}

export function SidebarNav({
  sections,
  orgId,
  pins = [],
  spaces,
  onNavigate,
}: {
  sections: NavSection[];
  orgId: string;
  pins?: SidebarPin[];
  /** Personal and the clubs (SpaceList), at the foot; folded away on the rail. */
  spaces?: React.ReactNode;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const { rail } = useSidebarMode();
  const all = sections.flatMap((s) => s.items);

  return (
    <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col">
      <div
        className={cn(
          "-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto px-1 pb-1",
          rail && "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        {sections.map((section) => (
          <div key={section.id} className="flex flex-col gap-0.5">
            {section.label && <GroupLabel label={section.label} />}
            {section.items.map((link) => (
              <NavItemLink
                key={link.id}
                link={link}
                pathname={pathname}
                search={search}
                all={all}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ))}
        <PinnedList
          pins={pins}
          orgId={orgId}
          pathname={pathname}
          search={search}
          onNavigate={onNavigate}
        />
      </div>
      {/* Personal and the clubs: at the foot of the sidebar, never pushed
          under the pins (they scroll on their own when there are many). */}
      {spaces && (
        <Fold open={!rail} className="border-border/60 mt-1 shrink-0 border-t pt-2">
          <div className="max-h-[40vh] overflow-y-auto">{spaces}</div>
        </Fold>
      )}
    </nav>
  );
}
