"use client";

import { useRef } from "react";

import { Popover, PopoverAnchor } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";

import { TokenMenu } from "./token-menu";
import { useTokenMenu } from "./use-token-menu";

/**
 * A Textarea with the two typing menus (useTokenMenu): "@" opens the member
 * list and inserts @[Name](user:id), which the server validates against
 * membership and renders as a chip; "/" opens the club's files and inserts
 * [Name.pdf](file:id), which renders as a link to the file. Arrow keys
 * move, Enter or Tab picks, Escape closes. Focus stays in the textarea.
 *
 * C4: on a private task the mention list is the task's audience, and the
 * popover says so. Offering somebody who cannot see the task would be
 * offering to send them a notification carrying its title; the server drops
 * such a mention anyway, and a picker that silently did nothing would be
 * worse than one that explains itself. Adding them as a collaborator is the
 * way in, which is what the line underneath tells you.
 */

export function MentionTextarea({
  value,
  onChange,
  onSubmitShortcut,
  audience,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Textarea>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  /** Ctrl/Cmd+Enter. */
  onSubmitShortcut?: () => void;
  /** C4: on a private task, the only people who may be mentioned. */
  audience?: readonly string[] | null;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const menu = useTokenMenu({ value, onChange, element: ref, audience });

  return (
    <Popover open={menu.open} onOpenChange={(o) => !o && menu.close()}>
      <PopoverAnchor asChild>
        <Textarea
          {...props}
          ref={ref}
          value={value}
          className={className}
          aria-autocomplete="list"
          aria-controls={menu.listId}
          aria-expanded={menu.open}
          onChange={(e) => {
            onChange(e.target.value);
            menu.detect(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyDown={(e) => {
            if (menu.handleKey(e)) return;
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && onSubmitShortcut) {
              e.preventDefault();
              onSubmitShortcut();
            }
          }}
          onBlur={() => setTimeout(() => menu.close(), 150)}
        />
      </PopoverAnchor>
      <TokenMenu menu={menu} audience={audience} width="w-64" />
    </Popover>
  );
}
