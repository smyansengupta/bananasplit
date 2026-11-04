"use client";

import { ChevronDown, Loader2, Plus } from "@/components/icons";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * Every page's one create action, the same everywhere (Tasks, Files,
 * Calendar, Finance, Databases): the white create pill at the full 40px,
 * its main action on the left and, when there are other ways to add
 * something, a chevron on the right that opens them. One glow for the
 * pair. Never a separate ••• for the same things.
 *
 *   <CreateSplitButton label="New task" onClick={newTask} menuLabel="More ways to add tasks">
 *     <DropdownMenuItem …>New epic</DropdownMenuItem>
 *   </CreateSplitButton>
 */
export function CreateSplitButton({
  label,
  icon,
  onClick,
  href,
  title,
  pending = false,
  disabled = false,
  menuLabel,
  children,
  className,
}: {
  label: ReactNode;
  /** Defaults to a plus. */
  icon?: ReactNode;
  onClick?: () => void;
  /** A link instead of onClick. */
  href?: string;
  title?: string;
  pending?: boolean;
  disabled?: boolean;
  /** The chevron's accessible name, e.g. "More ways to add tasks". */
  menuLabel?: string;
  /** DropdownMenuItems; without them it's a single button. */
  children?: ReactNode;
  className?: string;
}) {
  const glyph = pending ? (
    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
  ) : (
    (icon ?? <Plus className="size-4" aria-hidden="true" />)
  );
  const split = Boolean(children);
  const main = cn(split && "rounded-r-none pe-3");
  return (
    <div className={cn("glow-halo flex rounded-full", className)}>
      {href ? (
        <Button
          asChild
          variant="create"
          className={main}
          style={{ boxShadow: "none" }}
          title={title}
        >
          <Link href={href}>
            {glyph}
            {label}
          </Link>
        </Button>
      ) : (
        <Button
          type="button"
          variant="create"
          className={main}
          style={{ boxShadow: "none" }}
          title={title}
          disabled={disabled || pending}
          onClick={onClick}
        >
          {glyph}
          {label}
        </Button>
      )}
      {split && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="create"
              className="border-create-foreground/15 rounded-l-none border-l ps-2.5 pe-3"
              style={{ boxShadow: "none" }}
              disabled={disabled || pending}
              aria-label={menuLabel ?? "More ways to add"}
            >
              <ChevronDown className="size-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {children}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
