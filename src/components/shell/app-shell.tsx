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
import { type SidebarState } from "@/components/shell/sidebar-mode-context";
import { SidebarNav, type SidebarPin } from "@/components/shell/sidebar-nav";
import { SidebarPanel } from "@/components/shell/sidebar-panel";
import { SpaceList } from "@/components/shell/space-list";
import { ToolCapsule } from "@/components/shell/tool-capsule";
import type { OrgSummary, ShellUser } from "@/components/shell/types";
import { Toaster } from "@/components/ui/toaster";
import { ContextActionsHost } from "@/components/context-actions";
import type { Role } from "@/generated/prisma/enums";
import { serializeSidebarCookie, type SidebarMode } from "@/lib/sidebar-mode";
import { cn } from "@/lib/utils";

/**
 * The app's frame on every page of a space (the Moonstone shell):
 *
 * - the sidebar (sidebar-panel.tsx): docked, rail or peek, its mode kept
 *   per member in a cookie the org layout reads (`sidebarMode`), so the
 *   server renders the right one;
 * - the tool capsule (tool-capsule.tsx) at the top right, in place of the
 *   old top bar;
 * - below md, the menu button at the left of the tool capsule
 *   (nav-menu.tsx), which opens the phone's full-screen menu;
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
  const nav = (onNavigate?: () => void) => (
    <SidebarNav
      sections={sections}
      orgId={orgId}
      pins={pins}
      onNavigate={onNavigate}
      spaces={<SpaceList orgs={orgs} activeSlug={orgSlug} user={user} onNavigate={onNavigate} />}
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
    <PinsProvider orgId={orgId} orgSlug={orgSlug} pinnedHrefs={pins.map((p) => p.href)}>
      <div
        className={cn(
          "corona isolate grid min-h-svh grid-cols-1",
          "[--shell-bottom:calc(env(safe-area-inset-bottom)+1rem)] [--shell-top:4.25rem] md:[--shell-bottom:0px] md:[--shell-top:4.5rem]",
          "motion-reduce:transition-none md:transition-[grid-template-columns] md:duration-500 md:ease-(--ease-ink)",
          mode === "docked"
            ? "md:grid-cols-[248px_minmax(0,1fr)]"
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

        <SidebarPanel mode={mode} setMode={setMode} onToggle={toggleSidebar} clubMenu={clubMenu}>
          {nav()}
        </SidebarPanel>

        <div className="flex min-w-0 flex-col">
          <ToolCapsule
            menuButton={<NavMenu sections={sections} clubMenu={clubMenu} />}
            orgId={orgId}
            orgSlug={orgSlug}
            user={user}
            createActions={creatable}
            onSearch={() => setCommandOpen(true)}
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
  );
}
