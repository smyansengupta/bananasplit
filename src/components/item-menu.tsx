"use client";

import { MoreHorizontal, type IconComponent } from "@/components/icons";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { rowOf, useContextActions } from "@/components/context-actions";
import { cn } from "@/lib/utils";

/**
 * The "…" menu on every card and row (notes, files, tasks, transactions,
 * polls): the same place, the same look, Delete always last and red. It
 * may sit inside a link or a clickable row, so it keeps clicks to itself.
 *
 * Items that open a dialog (Delete → confirm) work because the menu is
 * non-modal: the dialog takes focus as the menu closes.
 *
 * The same items are the row's RIGHT-CLICK menu too: the button finds the
 * row it sits in (its list item, table row or card) and registers them
 * there, so nothing here is written twice and a new "…" menu anywhere gets
 * a right-click menu without being asked. See components/context-actions.
 */

export type ItemMenuEntry =
  | {
      label: string;
      icon?: IconComponent;
      onSelect?: () => void;
      href?: string;
      destructive?: boolean;
      disabled?: boolean;
      /** Starts a new group (a separator above it). */
      separated?: boolean;
    }
  | null
  | false
  | undefined;

export function ItemMenu({
  label,
  items,
  heading,
  className,
  align = "end",
  size = "sm",
}: {
  /** What the button is for, read out: "Actions for Kickoff notes". */
  label: string;
  items: readonly ItemMenuEntry[];
  heading?: string;
  className?: string;
  align?: "start" | "end";
  size?: "sm" | "xs";
}) {
  const entries = items.filter(Boolean) as Exclude<ItemMenuEntry, null | false | undefined>[];
  const button = useRef<HTMLButtonElement>(null);
  // The row this menu belongs to, found once the button is on the page.
  const [row, setRow] = useState<HTMLElement | null>(null);
  useEffect(() => setRow(rowOf(button.current) as HTMLElement | null), []);
  useContextActions(row, items, { heading: heading ?? label.replace(/^Actions for /, "") });
  if (entries.length === 0) return null;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          ref={button}
          type="button"
          aria-label={label}
          title="More actions"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className={cn(
            "text-muted-foreground hover:text-foreground hover:bg-muted data-[state=open]:bg-muted data-[state=open]:text-foreground focus-glow grid shrink-0 place-items-center rounded-full border border-transparent transition-[background-color,transform] outline-none active:scale-[0.94]",
            size === "sm" ? "size-8" : "size-7",
            className,
          )}
        >
          <MoreHorizontal className={size === "sm" ? "size-4" : "size-3.5"} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className="min-w-44"
        // Portalled, but React events still bubble to the card or row the
        // trigger sits in: keep clicks, drags and Enter from reaching it.
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {heading && (
          <DropdownMenuLabel className="text-muted-foreground truncate text-xs">
            {heading}
          </DropdownMenuLabel>
        )}
        {entries.map((item, i) => {
          const Icon = item.icon;
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
                  <Link href={item.href}>{body}</Link>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  disabled={item.disabled}
                  variant={item.destructive ? "destructive" : "default"}
                  onSelect={() => item.onSelect?.()}
                >
                  {body}
                </DropdownMenuItem>
              )}
            </Fragment>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
