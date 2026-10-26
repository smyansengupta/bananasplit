"use client";

import { useRef } from "react";

import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor } from "@/components/ui/popover";

import { TokenMenu } from "./token-menu";
import { useTokenMenu } from "./use-token-menu";

/**
 * A task's title, with `/` to link a club file.
 *
 * Titles take `/` but not `@`: a mention is a notification, which belongs
 * to the description and the comments, where the server reads them. `#tag`
 * is handled separately (useHashTags) because it is resolved on save, not
 * as you type.
 *
 * Two shapes, one behaviour: the composer's one-line field (TitleInput) and
 * the editor's title set straight on the panel (TitleTextarea, a textarea
 * so a long title wraps instead of scrolling sideways).
 */

export function TitleInput({
  value,
  onChange,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const menu = useTokenMenu({ value, onChange, element: ref, kinds: ["file"] });

  return (
    <Popover open={menu.open} onOpenChange={(o) => !o && menu.close()}>
      <PopoverAnchor asChild>
        <Input
          {...props}
          ref={ref}
          value={value}
          role="combobox"
          aria-autocomplete="list"
          aria-controls={menu.listId}
          aria-expanded={menu.open}
          onChange={(e) => {
            onChange(e.target.value);
            menu.detect(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyDown={(e) => {
            if (menu.handleKey(e)) return;
            props.onKeyDown?.(e);
          }}
          onBlur={(e) => {
            setTimeout(() => menu.close(), 150);
            props.onBlur?.(e);
          }}
        />
      </PopoverAnchor>
      <TokenMenu menu={menu} />
    </Popover>
  );
}

export function TitleTextarea({
  value,
  onChange,
  ...props
}: Omit<React.ComponentProps<"textarea">, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const menu = useTokenMenu({ value, onChange, element: ref, kinds: ["file"] });

  return (
    <Popover open={menu.open} onOpenChange={(o) => !o && menu.close()}>
      <PopoverAnchor asChild>
        <textarea
          {...props}
          ref={ref}
          value={value}
          // A text field that opens a list is a combobox; without the role
          // aria-expanded means nothing on a textarea.
          role="combobox"
          aria-autocomplete="list"
          aria-controls={menu.listId}
          aria-expanded={menu.open}
          onChange={(e) => {
            onChange(e.target.value);
            menu.detect(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyDown={(e) => {
            if (menu.handleKey(e)) return;
            props.onKeyDown?.(e);
          }}
          onBlur={(e) => {
            setTimeout(() => menu.close(), 150);
            props.onBlur?.(e);
          }}
        />
      </PopoverAnchor>
      <TokenMenu menu={menu} />
    </Popover>
  );
}
