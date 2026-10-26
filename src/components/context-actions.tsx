"use client";

import { MoreHorizontal, type IconComponent } from "@/components/icons";
import Link from "next/link";
import {
  Fragment,
  createContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ItemMenuEntry } from "@/components/item-menu";

/**
 * Right-click actions, anywhere in the app.
 *
 * Every card and row already declares what can be done to it, once, for its
 * "…" menu. This turns that same list into the right-click menu as well,
 * with no call site saying anything twice: a row registers its actions
 * against its own element, and one host near the root catches `contextmenu`,
 * walks up from whatever was clicked to the nearest registered element, and
 * opens the menu at the pointer.
 *
 * So anything with a "…" menu has a right-click menu with the same items in
 * the same order, and a surface without one — a task card, the Overview's Up
 * next — gets one by calling useContextActions.
 *
 * The browser's own menu is left alone where it is the useful one: in a text
 * field, over a selection, over a picture or a link, and on a second
 * right-click in the same place (so a page is never a trap). Holding Shift
 * always gets it back.
 */

interface Registered {
  items: readonly ItemMenuEntry[];
  heading?: string;
}

/**
 * Element → its actions. A WeakMap, so a row that unmounts is forgotten
 * without anyone having to remember to forget it.
 */
const REGISTRY = new WeakMap<Element, Registered>();

/** Marks an element as having right-click actions, for the walk up the tree. */
const MARK = "data-context-actions";

function register(el: Element, value: Registered) {
  REGISTRY.set(el, value);
  el.setAttribute(MARK, "");
  return () => {
    REGISTRY.delete(el);
    el.removeAttribute(MARK);
  };
}

/**
 * The row a "…" menu belongs to: the list item, table row or card it sits
 * in. Falls back to the button's own parent, which is the row in the few
 * places that are neither.
 */
export function rowOf(el: Element | null): Element | null {
  if (!el) return null;
  return el.closest("[data-context-row]") ?? el.closest("li, tr, article") ?? el.parentElement;
}

/**
 * Gives `ref`'s element a right-click menu. Pass the same entries the row's
 * "…" menu uses, or just the ones that make sense from a right-click.
 */
export function useContextActions(
  target: RefObject<HTMLElement | null> | HTMLElement | null,
  items: readonly ItemMenuEntry[],
  options: { heading?: string; enabled?: boolean } = {},
) {
  const { heading, enabled = true } = options;
  // The entries change identity on every render and the registry only reads
  // them when the menu opens, so keep a box rather than re-registering.
  const latest = useRef<Registered>({ items, heading });
  useEffect(() => {
    latest.current = { items, heading };
  });

  useEffect(() => {
    const el = target && "current" in target ? target.current : target;
    if (!el || !enabled) return;
    return register(el, {
      get items() {
        return latest.current.items;
      },
      get heading() {
        return latest.current.heading;
      },
    });
  }, [target, enabled]);
}

/** The row the open right-click menu belongs to, for anything that wants to mark it. */
const OpenRow = createContext<Element | null>(null);

interface MenuState {
  x: number;
  y: number;
  row: Element;
  entries: Exclude<ItemMenuEntry, null | false | undefined>[];
  heading?: string;
}

/**
 * Where the browser's own menu is the one people want: somewhere you type,
 * over text you have selected to copy, or with Shift held.
 *
 * NOT over a link or a picture. Almost every card and row in this app IS a
 * link — a file, a meeting, a note, an Up next card — so bailing out on
 * `a[href]` left the feature working on hardly anything. Its own menu
 * carries Open, which is what the link menu was for.
 */
function wantsNativeMenu(event: MouseEvent): boolean {
  if (event.shiftKey) return true;
  const target = event.target as HTMLElement | null;
  if (!target) return true;
  if (target.closest("input, textarea, select, [contenteditable='true']")) return true;
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
}

/**
 * Mounted once, inside the app shell. Everything above is inert without it.
 */
export function ContextActionsHost() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  // A second right-click in the same spot gives the browser's menu back.
  const last = useRef<{ x: number; y: number; at: number } | null>(null);

  useEffect(() => {
    function onContextMenu(event: MouseEvent) {
      if (wantsNativeMenu(event)) return;
      const near = last.current;
      if (
        near &&
        Date.now() - near.at < 4000 &&
        Math.abs(near.x - event.clientX) < 6 &&
        Math.abs(near.y - event.clientY) < 6
      ) {
        last.current = null;
        setMenu(null);
        return;
      }
      let node: Element | null = event.target as Element | null;
      while (node && !REGISTRY.has(node)) node = node.parentElement;
      if (!node) return;
      const found = REGISTRY.get(node)!;
      const entries = found.items.filter(Boolean) as MenuState["entries"];
      if (entries.length === 0) return;
      event.preventDefault();
      last.current = { x: event.clientX, y: event.clientY, at: Date.now() };
      setMenu({
        x: event.clientX,
        y: event.clientY,
        row: node,
        entries,
        heading: found.heading,
      });
    }
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);

  return (
    <OpenRow.Provider value={menu?.row ?? null}>
      <DropdownMenu
        modal={false}
        open={menu !== null}
        onOpenChange={(open) => !open && setMenu(null)}
      >
        {/* A point, not a button: the menu hangs off wherever the pointer was. */}
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden="true"
            className="pointer-events-none fixed size-0"
            style={menu ? { left: menu.x, top: menu.y } : { left: -9999, top: -9999 }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" sideOffset={2} className="min-w-44">
          {menu?.heading && (
            <DropdownMenuLabel className="text-muted-foreground max-w-56 truncate text-xs">
              {menu.heading}
            </DropdownMenuLabel>
          )}
          {menu && <MenuEntries entries={menu.entries} onDone={() => setMenu(null)} />}
        </DropdownMenuContent>
      </DropdownMenu>
    </OpenRow.Provider>
  );
}

/**
 * The entries, drawn exactly as ItemMenu draws them: Delete last and red,
 * a rule above a new group.
 */
export function MenuEntries({
  entries,
  onDone,
}: {
  entries: Exclude<ItemMenuEntry, null | false | undefined>[];
  onDone?: () => void;
}) {
  return (
    <>
      {entries.map((item, i) => {
        const Icon = item.icon as IconComponent | undefined;
        const body = (
          <>
            {Icon && <Icon className="size-4" aria-hidden="true" />}
            {item.label}
          </>
        );
        return (
          <Fragment key={`${item.label}-${i}`}>
            {(item.separated || (item.destructive && i > 0 && !entries[i - 1]?.destructive)) && (
              <DropdownMenuSeparator />
            )}
            {item.href ? (
              <DropdownMenuItem asChild disabled={item.disabled}>
                <Link href={item.href} onClick={() => onDone?.()}>
                  {body}
                </Link>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                disabled={item.disabled}
                variant={item.destructive ? "destructive" : "default"}
                onSelect={() => {
                  item.onSelect?.();
                  onDone?.();
                }}
              >
                {body}
              </DropdownMenuItem>
            )}
          </Fragment>
        );
      })}
    </>
  );
}

/**
 * A row that has right-click actions but no "…" button of its own. Wraps
 * one child and registers against it.
 */
export function ContextActions({
  items,
  heading,
  children,
}: {
  items: readonly ItemMenuEntry[];
  heading?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useContextActions(ref, items, { heading });
  return (
    <div ref={ref} data-context-row="" className="contents">
      {children}
    </div>
  );
}

/** Re-exported so a call site needs one import for both menus. */
export { MoreHorizontal };
