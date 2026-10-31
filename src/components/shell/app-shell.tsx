"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { PaletteSection } from "@/components/command-palette/catalog";
import { CommandPalette } from "@/components/command-palette/command-palette";
import { PinsProvider } from "@/components/pins/pins-context";
import { GlassRefraction } from "@/components/shell/glass-refraction";
import { KeyboardShortcuts } from "@/components/shell/keyboard-shortcuts";
import { NavMenu } from "@/components/shell/nav-menu";
import { createActions, type NavSection } from "@/components/shell/nav-config";
import { OrgSwitcher } from "@/components/shell/org-switcher";
import { VisitTracker } from "@/components/shell/pin-button";
import { SectionGate } from "@/components/shell/section-gate";
import { SidebarEditProvider, type SidebarEdit } from "@/components/shell/sidebar-edit-context";
import { type SidebarState } from "@/components/shell/sidebar-mode-context";
import { SidebarNav, type SidebarPin } from "@/components/shell/sidebar-nav";
import { SidebarPanel } from "@/components/shell/sidebar-panel";
import { SidebarPeople, type SidebarPeopleData } from "@/components/shell/sidebar-people";
import { SidebarTools } from "@/components/shell/sidebar-tools";
import { ToolCapsule } from "@/components/shell/tool-capsule";
import type { OrgSummary, ShellUser } from "@/components/shell/types";
import { UserMenu } from "@/components/shell/user-menu";
import { Toaster } from "@/components/ui/toaster";
import { ContextActionsHost } from "@/components/context-actions";
import { PendingLinkWatcher } from "@/components/links/pending-link";
import type { Role } from "@/generated/prisma/enums";
import {
  arrangeSections,
  EMPTY_MY_SIDEBAR,
  reorderGroup,
  serializeMySidebarCookie,
  toggleCollapsed,
  toggleHidden,
  type MySidebar,
} from "@/lib/nav/my-sidebar";
import { serializeSidebarCookie, type SidebarMode } from "@/lib/sidebar-mode";
import { cn } from "@/lib/utils";

/**
 * The app's frame on every page of a space (the Moonstone shell):
 *
 * - the sidebar (sidebar-panel.tsx): docked, rail or peek, its mode kept
 *   per member in a cookie the org layout reads (`sidebarMode`), so the
 *   server renders the right one;
 * - no top bar: search, New, the page's pin and you all live in the
 *   sidebar, so every page starts at the top of the window;
 * - below md, a floating menu button at the top left (tool-capsule.tsx,
 *   nav-menu.tsx), which opens the phone's full-screen menu;
 * - the corona (globals.css) drifting behind the top of the page, and the
 *   glass's refraction filter, mounted once.
 *
 * Below md, <main> clips sideways overflow: one wide row must never let
 * the whole page slide (and the phone zoom out). Wide content scrolls in
 * its own container instead.
 *
 * `--shell-top` and `--shell-bottom` are the room the floating chrome takes
 * at the top and bottom, for pages with sticky bars of their own.
 */
export function AppShell({
  orgSlug,
  orgId,
  orgs,
  user,
  brand,
  pins = [],
  counts = {},
  sections,
  sectionPaths = [],
  role = null,
  isAdmin = false,
  canInvite = false,
  canCreateEvents = false,
  taskViews = true,
  teamwork = true,
  sidebarMode = "docked",
  sidebarCookie,
  mySidebar = EMPTY_MY_SIDEBAR,
  mySidebarCookie,
  people = null,
  banner,
  children,
}: {
  orgSlug: string;
  orgId: string;
  orgs: OrgSummary[];
  user: ShellUser;
  /** The org's logo and name (Admin panel › Theme › Logo display): the club menu's face. */
  brand?: React.ReactNode;
  /** The member's pins in this org (sidebar, and the pin button's state). */
  pins?: SidebarPin[];
  /** The org's sidebar (Admin panel › Sidebar). */
  sections: NavSection[];
  /** Small counts beside sidebar entries, by section id (Inbox, Forms, Finance). */
  counts?: Record<string, number>;
  /**
   * Every section (path, name, icon) and whether the org turned it off:
   * members see a notice there, and search leaves it out for them.
   */
  sectionPaths?: PaletteSection[];
  /** The member's role in this org (what search may show them). */
  role?: Role | null;
  isAdmin?: boolean;
  /** May invite members (the club menu's "Invite people"). */
  canInvite?: boolean;
  /** May create events (the create menu's "New event"). */
  canCreateEvents?: boolean;
  /** The plan has Board, Week and Table (the shortcut sheet lists their keys). */
  taskViews?: boolean;
  /** The weekly update exists (not in Personal). */
  teamwork?: boolean;
  /** The member's stored sidebar mode (src/lib/sidebar-mode-cookie.ts). */
  sidebarMode?: SidebarMode;
  /** The member's sidebar cookie name (sidebarCookieName); without it, the mode isn't kept. */
  sidebarCookie?: string;
  /** Your own order and hidden rows in this organization (src/lib/nav/my-sidebar.ts). */
  mySidebar?: MySidebar;
  /** Its cookie's name (mySidebarCookieName); without it, edits last until you leave. */
  mySidebarCookie?: string;
  /** Who's here now, at the sidebar's foot (none in Personal). */
  people?: SidebarPeopleData | null;
  /** Above every page: the club's trial or paused notice (SpaceBanner). */
  banner?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [mode, setMode] = useState<SidebarState>(sidebarMode);
  // Each opening is a new session (a fresh palette: empty box, no stale results).
  const [command, setCommand] = useState({ open: false, session: 0 });
  const setCommandOpen = (open: boolean) =>
    setCommand((c) => (open === c.open ? c : { open, session: open ? c.session + 1 : c.session }));
  const shortcutLinks = useMemo(
    () => sections.flatMap((s) => s.items).filter((i) => !i.locked),
    [sections],
  );
  const creatable = useMemo(
    () => createActions(sections, { canCreateEvents }),
    [sections, canCreateEvents],
  );

  /** Docks or collapses the sidebar, and remembers it. */
  const keepMode = useCallback(
    (next: SidebarMode) => {
      setMode(next);
      if (sidebarCookie) {
        document.cookie = serializeSidebarCookie(
          sidebarCookie,
          next,
          window.location.protocol === "https:",
        );
      }
    },
    [sidebarCookie],
  );
  const toggleSidebar = useCallback(
    () => keepMode(mode === "docked" ? "rail" : "docked"),
    [keepMode, mode],
  );

  // Edit sidebar: your order and hidden rows, kept in a cookie as you go.
  const [my, setMy] = useState<MySidebar>(mySidebar);
  const [editing, setEditing] = useState(false);
  const edit = useMemo<SidebarEdit>(() => {
    const keep = (next: MySidebar) => {
      setMy(next);
      if (mySidebarCookie) {
        document.cookie = serializeMySidebarCookie(
          mySidebarCookie,
          next,
          window.location.protocol === "https:",
        );
      }
    };
    return {
      my,
      editing,
      startEditing: () => {
        if (mode !== "docked") keepMode("docked");
        setEditing(true);
      },
      stopEditing: () => setEditing(false),
      reorder: (groupIds) => keep(reorderGroup(my, sections, groupIds)),
      toggle: (id) => keep(toggleHidden(my, id)),
      toggleGroup: (id) => keep(toggleCollapsed(my, id)),
      reset: () => keep({ ...EMPTY_MY_SIDEBAR, collapsed: my.collapsed }),
    };
  }, [my, editing, mode, keepMode, mySidebarCookie, sections]);
  // The phone's menu follows the same arrangement.
  const mySections = useMemo(() => arrangeSections(sections, my), [sections, my]);

  const clubMenu = (
    <OrgSwitcher
      orgs={orgs}
      activeSlug={orgSlug}
      user={user}
      brand={brand}
      isAdmin={isAdmin}
      canInvite={canInvite}
    />
  );
  const profile = <UserMenu user={user} variant="corner" />;
  const nav = (onNavigate?: () => void) => (
    <SidebarNav
      sections={sections}
      orgId={orgId}
      pins={pins}
      counts={counts}
      tools={
        <SidebarTools
          orgId={orgId}
          orgSlug={orgSlug}
          createActions={creatable}
          onSearch={() => setCommandOpen(true)}
          onNavigate={onNavigate}
        />
      }
      onNavigate={onNavigate}
    />
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommand((c) => ({ open: !c.open, session: c.open ? c.session : c.session + 1 }));
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <SidebarEditProvider value={edit}>
      <PinsProvider orgId={orgId} orgSlug={orgSlug} pinnedHrefs={pins.map((p) => p.href)}>
        <div
          className={cn(
            "corona isolate grid min-h-svh grid-cols-1",
            "[--shell-bottom:calc(env(safe-area-inset-bottom)+1rem)] [--shell-top:4.25rem] md:[--shell-bottom:0px] md:[--shell-top:0.75rem]",
            "motion-reduce:transition-none md:transition-[grid-template-columns] md:duration-500 md:ease-(--ease-ink)",
            mode === "docked"
              ? "md:grid-cols-[264px_minmax(0,1fr)]"
              : "md:grid-cols-[96px_minmax(0,1fr)]",
          )}
        >
          <a
            href="#main-content"
            className="bg-background text-foreground focus-glow sr-only rounded-full px-4 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
          >
            Skip to content
          </a>
          <GlassRefraction />

          <SidebarPanel
            mode={mode}
            setMode={setMode}
            onToggle={toggleSidebar}
            clubMenu={clubMenu}
            profile={profile}
            people={people && <SidebarPeople orgId={orgId} orgSlug={orgSlug} people={people} />}
          >
            {nav()}
          </SidebarPanel>

          <div className="flex min-w-0 flex-col">
            <ToolCapsule
              menuButton={
                <NavMenu
                  sections={mySections}
                  clubMenu={clubMenu}
                  user={user}
                  counts={counts}
                  orgId={orgId}
                  orgSlug={orgSlug}
                  createActions={creatable}
                  onSearch={() => setCommandOpen(true)}
                />
              }
            />
            <main
              id="main-content"
              className="reveal-page relative isolate min-w-0 flex-1 py-4 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] max-md:overflow-x-clip md:p-6"
            >
              {banner}
              <SectionGate orgSlug={orgSlug} sectionPaths={sectionPaths} isAdmin={isAdmin}>
                {children}
              </SectionGate>
            </main>
            {/* Room under the last of the page, clear of the home indicator. */}
            <div aria-hidden="true" className="h-(--shell-bottom) shrink-0 md:hidden" />
          </div>

          <VisitTracker orgId={orgId} />
          <PendingLinkWatcher orgId={orgId} orgSlug={orgSlug} />
          <KeyboardShortcuts
            orgSlug={orgSlug}
            links={shortcutLinks}
            isAdmin={isAdmin}
            taskViews={taskViews}
            teamwork={teamwork}
            onToggleSidebar={toggleSidebar}
          />
          <CommandPalette
            key={command.session}
            orgId={orgId}
            orgSlug={orgSlug}
            role={role}
            sections={sectionPaths}
            orgs={orgs}
            open={command.open}
            onOpenChange={setCommandOpen}
          />
          <Toaster />
          {/* One listener for every right-click menu in the app. */}
          <ContextActionsHost />
        </div>
      </PinsProvider>
    </SidebarEditProvider>
  );
}
