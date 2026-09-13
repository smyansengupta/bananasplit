"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";

export interface LabelOption {
  id: string;
  name: string;
  color: string;
}

export function LabelPicker({
  labels,
  selectedIds,
  onChange,
  disabled,
}: {
  labels: LabelOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = labels.filter((l) => selectedIds.includes(l.id));

  function toggle(labelId: string) {
    onChange(
      selectedIds.includes(labelId)
        ? selectedIds.filter((id) => id !== labelId)
        : [...selectedIds, labelId],
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
          <span className="flex flex-wrap gap-1">
            {selected.length === 0 && <span className="text-muted-foreground">No labels</span>}
            {selected.map((l) => (
              <Badge
                key={l.id}
                style={{ backgroundColor: l.color, color: "white" }}
                className="border-0"
              >
                {l.name}
              </Badge>
            ))}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search labels…" />
          <CommandList>
            <CommandEmpty>No labels found.</CommandEmpty>
            <CommandGroup>
              {labels.map((l) => (
                <CommandItem key={l.id} value={l.name} onSelect={() => toggle(l.id)}>
                  <Check
                    className={cn(
                      "size-4",
                      selectedIds.includes(l.id) ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: l.color }}
                    aria-hidden="true"
                  />
                  {l.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
