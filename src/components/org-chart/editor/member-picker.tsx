"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";

/**
 * Single-select member picker (the AssigneePicker pattern): confirms who
 * holds a position. Suggestions from the matcher are listed first.
 */

export interface EditorMember {
  id: string;
  name: string | null;
  image: string | null;
  avatar: unknown;
  title: string | null;
}

export function MemberPicker({
  members,
  value,
  suggestedIds,
  onSelect,
  disabled,
}: {
  members: EditorMember[];
  value: string | null;
  suggestedIds: string[];
  onSelect: (member: EditorMember) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const byId = new Map(members.map((m) => [m.id, m]));
  const suggested = suggestedIds
    .map((id) => byId.get(id))
    .filter((m): m is EditorMember => Boolean(m));
  const others = members.filter((m) => !suggestedIds.includes(m.id));
  const selected = value ? byId.get(value) : undefined;

  const item = (m: EditorMember) => (
    <CommandItem
      key={m.id}
      value={`${m.name ?? ""} ${m.id}`}
      onSelect={() => {
        onSelect(m);
        setOpen(false);
      }}
    >
      <Check
        className={cn("size-4", value === m.id ? "opacity-100" : "opacity-0")}
        aria-hidden="true"
      />
      <UserAvatar user={m} size="xs" />
      <span className="truncate">{m.name ?? "Unnamed member"}</span>
      {m.title && <span className="text-muted-foreground ml-auto truncate text-xs">{m.title}</span>}
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected ? (
              <>
                <UserAvatar user={selected} size="xs" />
                <span className="truncate">{selected.name}</span>
              </>
            ) : (
              <span className="text-muted-foreground">Link a member…</span>
            )}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search members…" />
          <CommandList>
            <CommandEmpty>No members found.</CommandEmpty>
            {suggested.length > 0 && (
              <>
                <CommandGroup heading="Suggested">{suggested.map(item)}</CommandGroup>
                <CommandSeparator />
              </>
            )}
            <CommandGroup heading="All members">{others.map(item)}</CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
