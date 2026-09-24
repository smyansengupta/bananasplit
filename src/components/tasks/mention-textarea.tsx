"use client";

import { useMemo, useRef, useState } from "react";

import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/user-avatar";
import { mentionToken } from "@/lib/tasks/mentions";

import { useTasks } from "./tasks-context";

/**
 * A Textarea with @mentions: typing "@" opens a member popover (cmdk);
 * picking someone inserts the token @[Name](user:id), which the server
 * validates against membership and renders as a chip. Arrow keys move,
 * Enter or Tab picks, Escape closes. Focus stays in the textarea.
 */

const TRIGGER = /(?:^|[\s(])@([\p{L}\p{N}._'-]{0,30})$/u;
const MAX_OPTIONS = 8;

export function MentionTextarea({
  value,
  onChange,
  onSubmitShortcut,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Textarea>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  /** Ctrl/Cmd+Enter. */
  onSubmitShortcut?: () => void;
}) {
  const { members } = useTasks();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [trigger, setTrigger] = useState<{ query: string; start: number; end: number } | null>(null);
  const [highlight, setHighlight] = useState(0);

  const options = useMemo(() => {
    if (!trigger) return [];
    const q = trigger.query.toLowerCase();
    return members
      .filter((m) => (m.name ?? "").toLowerCase().split(/\s+/).some((part) => part.startsWith(q)) || (m.name ?? "").toLowerCase().includes(q))
      .slice(0, MAX_OPTIONS);
  }, [members, trigger]);

  function detect(text: string, caret: number) {
    const match = TRIGGER.exec(text.slice(0, caret));
    if (!match) {
      setTrigger(null);
      return;
    }
    setTrigger({ query: match[1] ?? "", start: caret - (match[1]?.length ?? 0) - 1, end: caret });
    setHighlight(0);
  }

  function insert(memberId: string) {
    const member = members.find((m) => m.id === memberId);
    if (!member || !trigger) return;
    const token = `${mentionToken(member.name ?? "member", member.id)} `;
    const next = value.slice(0, trigger.start) + token + value.slice(trigger.end);
    onChange(next);
    setTrigger(null);
    const caret = trigger.start + token.length;
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(caret, caret);
    });
  }

  const open = trigger !== null && options.length > 0;

  return (
    <Popover open={open} onOpenChange={(o) => !o && setTrigger(null)}>
      <PopoverAnchor asChild>
        <Textarea
          {...props}
          ref={ref}
          value={value}
          className={className}
          aria-autocomplete="list"
          aria-expanded={open}
          onChange={(e) => {
            onChange(e.target.value);
            detect(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyDown={(e) => {
            if (open) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((h) => (h + 1) % options.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((h) => (h - 1 + options.length) % options.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                insert(options[highlight]!.id);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setTrigger(null);
                return;
              }
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && onSubmitShortcut) {
              e.preventDefault();
              onSubmitShortcut();
            }
          }}
          onBlur={() => setTimeout(() => setTrigger(null), 150)}
        />
      </PopoverAnchor>
      <PopoverContent
        className="w-64 p-0"
        align="start"
        side="bottom"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false} value={options[highlight]?.id ?? ""}>
          <CommandList>
            <CommandGroup heading="Mention a member">
              {options.map((m, i) => (
                <CommandItem
                  key={m.id}
                  value={m.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onSelect={() => insert(m.id)}
                  onMouseEnter={() => setHighlight(i)}
                >
                  <UserAvatar user={m} size="xs" />
                  <span className="truncate">{m.name ?? "Member"}</span>
                  {m.title && <span className="text-muted-foreground ml-auto truncate text-xs">{m.title}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
