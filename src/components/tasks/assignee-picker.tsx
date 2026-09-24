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

export interface OrgMemberOption {
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
  /** Uploaded avatar variants (User.avatar), when the caller has them. */
  avatar?: unknown;
}

export function AssigneePicker({
  members,
  selectedIds,
  onChange,
  disabled,
}: {
  members: OrgMemberOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = members.filter((m) => selectedIds.includes(m.userId));

  function toggle(userId: string) {
    onChange(
      selectedIds.includes(userId)
        ? selectedIds.filter((id) => id !== userId)
        : [...selectedIds, userId],
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="flex items-center -space-x-2">
            {selected.length === 0 && <span className="text-muted-foreground">Unassigned</span>}
            {selected.map((m) => (
              <UserAvatar
                key={m.userId}
                user={{ name: m.name, email: m.email, image: m.image, avatar: m.avatar }}
                size="sm"
              />
            ))}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search members…" />
          <CommandList>
            <CommandEmpty>No members found.</CommandEmpty>
            <CommandGroup>
              {members.map((m) => (
                <CommandItem
                  key={m.userId}
                  value={m.name ?? m.email}
                  onSelect={() => toggle(m.userId)}
                >
                  <Check
                    className={cn(
                      "size-4",
                      selectedIds.includes(m.userId) ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <UserAvatar user={{ name: m.name, email: m.email, image: m.image, avatar: m.avatar }} size="xs" />
                  {m.name ?? m.email}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
