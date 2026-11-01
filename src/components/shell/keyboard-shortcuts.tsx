"use client";

import { usePathname, useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { useModKey } from "@/components/command-palette/use-mod-key";
import type { NavLink } from "@/components/shell/nav-config";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  GO_TO_SETTINGS_KEY,
  goToKey,
  hasModifier,
  isShortcutSheetKey,
  isSidebarToggleKey,
  isTypingTarget,
  NEW_TASK_PARAM,
  OPEN_SHORTCUTS_EVENT,
  overlayOpen,
  SEQUENCE_TIMEOUT_MS,
  shortcutGroups,
  TASK_KEYS,
  type ShortcutRow,
} from "@/lib/shortcuts";

/**
 * The app's keyboard layer, on every page of a space:
 *
 * - ⌘/ or Ctrl / (Ctrl works on a Mac too), or ? outside a field, opens the
 *   sheet of every shortcut; the ⌘K palette's "Keyboard shortcuts" too.
 * - ⌘\ or Ctrl \ collapses the sidebar to its rail, or docks it again.
 * - `g` then a letter opens a sidebar section (g t Tasks, g c Calendar...),
 *   and g s Settings for owners and admins.
 * - `c` starts a task from anywhere: the task workspace handles its own c,
 *   and elsewhere this opens Tasks with ?new=1, which starts one there.
 *
 * Keys and rows come from src/lib/shortcuts.ts. This listens on the
 * document, ahead of the pages' window listeners, so the letter after `g`
 * is claimed (preventDefault) before a page reads it as its own shortcut.
 */
export function KeyboardShortcuts({
  orgSlug,
  links,
  isAdmin,
  taskViews,
  teamwork,
  onToggleSidebar,
}: {
  orgSlug: string;
  /** The sidebar's links (the plan's locked ones already left out). */
  links: readonly NavLink[];
  isAdmin: boolean;
  /** Board, Week and Table exist (not the Free plan's List only). */
  taskViews: boolean;
  /** The weekly update exists (not Personal). */
  teamwork: boolean;
  /** ⌘\: dock or collapse the sidebar. */
  onToggleSidebar?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const mod = useModKey();
  const [open, setOpen] = useState(false);
  const gPressedAt = useRef(0);
  const base = `/app/${orgSlug}`;
  const tasksHref = links.find((l) => l.id === "tasks")?.href;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isShortcutSheetKey(event)) {
        event.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (onToggleSidebar && isSidebarToggleKey(event)) {
        event.preventDefault();
        onToggleSidebar();
        return;
      }
      const sequence =
        gPressedAt.current > 0 && Date.now() - gPressedAt.current < SEQUENCE_TIMEOUT_MS;
      gPressedAt.current = 0;
      if (event.defaultPrevented || hasModifier(event) || isTypingTarget(event) || overlayOpen()) {
        return;
      }
      const key = event.key.toLowerCase();

      if (sequence) {
        // The letter after g is always the sequence's, mapped or not.
        event.preventDefault();
        const href =
          key === GO_TO_SETTINGS_KEY && isAdmin
            ? `${base}/settings`
            : links.find((l) => goToKey(l.id) === key)?.href;
        if (href) router.push(href);
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        setOpen(true);
        return;
      }
      if (key === "g" && !event.shiftKey) {
        event.preventDefault();
        gPressedAt.current = Date.now();
        return;
      }
      if (key === TASK_KEYS.newTask && pathname !== tasksHref) {
        // "c" opens New right here, over the page (the sidebar's New menu);
        // without a visible sidebar (a phone), it goes to Tasks' new task.
        const newButton = document.querySelector<HTMLButtonElement>("[data-new-button]");
        if (newButton && newButton.offsetParent !== null) {
          event.preventDefault();
          newButton.click();
          return;
        }
        if (tasksHref) {
          event.preventDefault();
          router.push(`${tasksHref}?${NEW_TASK_PARAM}=1`);
        }
      }
    }
    const openSheet = () => setOpen(true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_SHORTCUTS_EVENT, openSheet);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_SHORTCUTS_EVENT, openSheet);
    };
  }, [base, isAdmin, links, onToggleSidebar, pathname, router, tasksHref]);

  const groups = useMemo(
    () =>
      shortcutGroups({
        mod,
        sections: links.map((l) => ({ id: l.id, label: l.label })),
        isAdmin,
        taskViews,
        teamwork,
      }),
    [mod, links, isAdmin, taskViews, teamwork],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Single keys work when you&apos;re not typing in a field. Open this list any time with{" "}
            <Kbd>{mod}</Kbd> <Kbd>/</Kbd>
            {mod === "⌘" && (
              <>
                {" "}
                (or <Kbd>Ctrl</Kbd> <Kbd>/</Kbd>)
              </>
            )}{" "}
            or <Kbd>?</Kbd>.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {groups.map((group) => (
            <section key={group.title} aria-labelledby={`kbd-${group.title}`}>
              <h3
                id={`kbd-${group.title}`}
                className="text-muted-foreground mb-1.5 text-[11px] font-semibold tracking-[0.05em] uppercase"
              >
                {group.title}
              </h3>
              <dl className="divide-y">
                {group.rows.map((row) => (
                  <div
                    key={`${row.label}-${row.keys.flat().join("")}`}
                    className="flex items-center justify-between gap-3 py-1.5"
                  >
                    <dt className="min-w-0 text-[13px]">{row.label}</dt>
                    <dd className="flex shrink-0 items-center gap-1">
                      <Keys row={row} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Keys({ row }: { row: ShortcutRow }) {
  return row.keys.map((combo, i) => (
    <Fragment key={combo.join("+")}>
      {i > 0 && <span className="text-muted-foreground text-[11px]">or</span>}
      {combo.map((key, j) => (
        <Fragment key={key}>
          {row.sequence && j > 0 && <span className="text-muted-foreground text-[11px]">then</span>}
          <Kbd>{key}</Kbd>
        </Fragment>
      ))}
    </Fragment>
  ));
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="bg-muted text-foreground inline-flex h-5 min-w-5 items-center justify-center rounded-md border px-1 font-sans text-[11px] leading-none font-medium">
      {children}
    </kbd>
  );
}
