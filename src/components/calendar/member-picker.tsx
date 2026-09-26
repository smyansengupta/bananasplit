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
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import type { OrgMemberOption } from "@/server/members";

/** A member as the calendar's pickers show them (the userPublicSelect shape). */
export type CalendarMember = Pick<OrgMemberOption, "id" | "name" | "image" | "avatar" | "title">;

/** Multi-select of org members (event attendees). */
export function MemberMultiPicker({
  id,
  members,
  selectedIds,
  onChange,
  disabled,
  placeholder = "Nobody invited",
}: {
  id?: string;
  members: CalendarMember[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = members.filter((m) => selectedIds.includes(m.id));

  function toggle(userId: string) {
    onChange(selectedIds.includes(userId) ? selectedIds.filter((x) => x !== userId) : [...selectedIds, userId]);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected.length === 0 ? (
              <span className="text-muted-foreground">{placeholder}</span>
            ) : (
              <>
                <span className="flex -space-x-2">
                  {selected.slice(0, 6).map((m) => (
                    <UserAvatar key={m.id} user={m} size="sm" className="border-background border-2" />
                  ))}
                </span>
                <span className="text-muted-foreground truncate text-xs">{selected.length} invited</span>
              </>
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
            <CommandGroup>
              {members.map((m) => (
                <CommandItem key={m.id} value={`${m.name ?? ""} ${m.id}`} onSelect={() => toggle(m.id)}>
                  <Check className={cn("size-4", selectedIds.includes(m.id) ? "opacity-100" : "opacity-0")} />
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
