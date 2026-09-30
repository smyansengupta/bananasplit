"use client";

import { Menu, Search } from "lucide-react";
import { useEffect, useState } from "react";

import { CommandPalette } from "@/components/command-palette/command-palette";
import { NotificationBell } from "@/components/shell/notification-bell";
import { OrgSwitcher } from "@/components/shell/org-switcher";
import { PinButton, VisitTracker } from "@/components/shell/pin-button";
import type { NavLink, NavSection } from "@/components/shell/nav-config";
import { SectionGate } from "@/components/shell/section-gate";
import { SidebarNav, type SidebarPin } from "@/components/shell/sidebar-nav";
import { UserMenu } from "@/components/shell/user-menu";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { OrgSummary, ShellUser } from "@/components/shell/types";

export function AppShell({
  orgSlug,
  orgId,
  orgs,
  user,
  brand,
  pins = [],
  sections,
  settings,
  sectionPaths = [],
  isAdmin = false,
  children,
}: {
  orgSlug: string;
  orgId: string;
  orgs: OrgSummary[];
  user: ShellUser;
  /** The org's logo and name (Settings > Theme > Logo display), above the switcher. */
  brand?: React.ReactNode;
  /** The member's pins in this org (sidebar, and the pin button's state). */
  pins?: SidebarPin[];
  /** The org's sidebar (Settings › Sidebar). */
  sections: NavSection[];
  settings: NavLink;
  /** Every section's path and whether the org turned it off (members see a notice). */
  sectionPaths?: { path: string; hidden: boolean }[];
  isAdmin?: boolean;
  children: React.ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((value) => !value);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[16rem_1fr]">
      <a
        href="#main-content"
        className="bg-background text-foreground focus:ring-ring sr-only rounded-md px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:ring-2"
      >
        Skip to content
      </a>

      <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border hidden flex-col gap-4 border-r p-4 md:sticky md:top-0 md:flex md:h-screen">
        {brand}
        <OrgSwitcher orgs={orgs} activeSlug={orgSlug} />
        <SidebarNav sections={sections} settings={settings} orgId={orgId} pins={pins} />
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="bg-background/95 supports-backdrop-filter:bg-background/60 sticky top-0 z-40 flex items-center gap-3 border-b px-4 py-3 backdrop-blur">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label="Open navigation menu"
              >
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="bg-sidebar text-sidebar-foreground flex w-72 flex-col p-4">
              <SheetHeader className="gap-3 p-0">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                {brand}
                <OrgSwitcher orgs={orgs} activeSlug={orgSlug} />
              </SheetHeader>
              <div className="mt-4 flex min-h-0 flex-1 flex-col">
                <SidebarNav
                  sections={sections}
                  settings={settings}
                  orgId={orgId}
                  pins={pins}
                  onNavigate={() => setMobileNavOpen(false)}
                />
              </div>
            </SheetContent>
          </Sheet>

          <Button
            variant="outline"
            size="sm"
            className="text-muted-foreground gap-2"
            onClick={() => setCommandOpen(true)}
          >
            <Search className="size-4" />
            <span className="hidden sm:inline">Search</span>
            <kbd className="bg-muted hidden rounded px-1.5 py-0.5 text-xs sm:inline">⌘K</kbd>
          </Button>

          <div className="flex-1" />
          <PinButton orgId={orgId} pinnedHrefs={pins.map((p) => p.href)} />
          <NotificationBell />
          <UserMenu user={user} />
        </header>

        <main id="main-content" className="min-w-0 flex-1 p-4 md:p-6">
          <SectionGate orgSlug={orgSlug} sectionPaths={sectionPaths} isAdmin={isAdmin}>
            {children}
          </SectionGate>
        </main>
      </div>

      <VisitTracker orgId={orgId} />
      <CommandPalette
        orgId={orgId}
        orgSlug={orgSlug}
        open={commandOpen}
        onOpenChange={setCommandOpen}
      />
    </div>
  );
}
