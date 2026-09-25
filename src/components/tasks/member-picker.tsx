"use client";

import { Check, ChevronsUpDown, TriangleAlert, X } from "lucide-react";
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
import { relationFor, type AssignmentRelationValue } from "@/lib/tasks/assignment";
import { cn } from "@/lib/utils";

import { useTasks } from "./tasks-context";
import type { MemberOption } from "./types";

/**
 * Member pickers for the owner (single) and "also involved" (multi). Each
 * option shows how assigning that person relates to you in the org chart;
 * "Above you" is flagged when saved (you'll be asked to confirm).
 */

const RELATION_HINT: Partial<Record<AssignmentRelationValue, string>> = {
  SELF: "You",
  DOWN_LINE: "Your team",
  ABOVE: "Above you",
};

function RelationHint({ userId }: { userId: string }) {
  const { viewer } = useTasks();
  const relation = relationFor(viewer.chart, userId);
  const hint = RELATION_HINT[relation];
  if (!hint) return null;
  return (
    <span
      className={cn(
        "ml-auto shrink-0 text-xs",
        relation === "ABOVE" ? "text-warning" : "text-muted-foreground",
      )}
    >
      {relation === "ABOVE" && (
        <TriangleAlert className="mr-0.5 inline size-3" aria-hidden="true" />
      )}
      {hint}
    </span>
  );
}

function MemberOptionsList({
  members,
  isSelected,
  onSelect,
  placeholder,
}: {
  members: MemberOption[];
  isSelected: (id: string) => boolean;
  onSelect: (id: string) => void;
  placeholder: string;
}) {
  return (
    <Command>
      <CommandInput placeholder={placeholder} />
      <CommandList>
        <CommandEmpty>No members found.</CommandEmpty>
        <CommandGroup>
          {members.map((m) => (
            <CommandItem
              key={m.id}
              value={`${m.name ?? ""} ${m.title ?? ""} ${m.id}`}
              onSelect={() => onSelect(m.id)}
            >
              <Check
                className={cn("size-4 shrink-0", isSelected(m.id) ? "opacity-100" : "opacity-0")}
              />
              <UserAvatar user={m} size="xs" />
              <span className="min-w-0 truncate">
                {m.name ?? "Member"}
                {m.title && <span className="text-muted-foreground ml-1 text-xs">{m.title}</span>}
              </span>
              <RelationHint userId={m.id} />
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

export function OwnerPicker({
  value,
  onChange,
  disabled,
  allowNone = true,
  id,
  compact,
}: {
  value: string | null;
  onChange: (userId: string | null) => void;
  disabled?: boolean;
  allowNone?: boolean;
  id?: string;
  compact?: boolean;
}) {
  const { members, memberById } = useTasks();
  const [open, setOpen] = useState(false);
  const selected = value ? memberById.get(value) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={compact ? `Owner: ${selected?.name ?? "none"}` : undefined}
          disabled={disabled}
          className={cn(
            "justify-between font-normal",
            compact ? "h-8 w-auto gap-1 px-2" : "w-full",
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected ? (
              <>
                <UserAvatar user={selected} size="xs" />
                {!compact && <span className="truncate">{selected.name ?? "Member"}</span>}
              </>
            ) : (
              <span className="text-muted-foreground">{compact ? "Owner" : "No owner"}</span>
            )}
          </span>
          {!compact && <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <MemberOptionsList
          members={members}
          placeholder="Search members…"
          isSelected={(mid) => mid === value}
          onSelect={(mid) => {
            onChange(mid === value && allowNone ? null : mid);
            setOpen(false);
          }}
        />
        {allowNone && value && (
          <div className="border-t p-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              <X className="size-4" /> Clear owner
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function CollaboratorsPicker({
  value,
  onChange,
  disabled,
  exclude,
  id,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  /** The owner: never also a collaborator. */
  exclude?: string | null;
  id?: string;
}) {
  const { members, memberById } = useTasks();
  const [open, setOpen] = useState(false);
  const selected = value.map((v) => memberById.get(v)).filter((m): m is MemberOption => Boolean(m));
  const options = members.filter((m) => m.id !== exclude);

  function toggle(userId: string) {
    onChange(value.includes(userId) ? value.filter((v) => v !== userId) : [...value, userId]);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-auto min-h-9 w-full justify-between font-normal"
        >
          <span className="flex flex-wrap items-center gap-1">
            {selected.length === 0 && <span className="text-muted-foreground">Nobody else</span>}
            {selected.map((m) => (
              <span
                key={m.id}
                className="bg-muted inline-flex items-center gap-1 rounded-full py-0.5 pr-2 pl-0.5 text-xs"
              >
                <UserAvatar user={m} size="xs" />
                {m.name ?? "Member"}
              </span>
            ))}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <MemberOptionsList
          members={options}
          placeholder="Search members…"
          isSelected={(mid) => value.includes(mid)}
          onSelect={toggle}
        />
      </PopoverContent>
    </Popover>
  );
}
