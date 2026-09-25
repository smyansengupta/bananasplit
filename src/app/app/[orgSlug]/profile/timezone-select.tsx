"use client";

import { Check, ChevronsUpDown, LocateFixed } from "lucide-react";
import { useMemo, useState } from "react";

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
import { isValidTimeZone, listTimeZones, timeZoneLabel } from "@/lib/profile/timezone";
import { cn } from "@/lib/utils";

const FOLLOW_ORG = "__org__";

/**
 * Timezone picker: "Use the organization's timezone" (stored as null) or any
 * IANA zone, with a shortcut to the browser's own zone. The zone list is
 * built only when the popover opens.
 */
export function TimezoneSelect({
  id,
  value,
  orgTimezone,
  onChange,
  invalid,
}: {
  id?: string;
  value: string | null;
  orgTimezone: string;
  onChange: (value: string | null) => void;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const zones = useMemo(() => (open ? listTimeZones() : []), [open]);
  const detected = useMemo(() => {
    if (!open) return null;
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(zone) ? zone : null;
  }, [open]);

  function choose(next: string | null) {
    onChange(next);
    setOpen(false);
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
          aria-invalid={invalid || undefined}
          className="w-full justify-between font-normal"
        >
          <span className="min-w-0 truncate">
            {value
              ? timeZoneLabel(value)
              : `Organization's timezone (${timeZoneLabel(orgTimezone)})`}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search timezones…" />
          <CommandList>
            <CommandEmpty>No timezone found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={`${FOLLOW_ORG} organization default`}
                onSelect={() => choose(null)}
              >
                <Check className={cn("size-4", value === null ? "opacity-100" : "opacity-0")} />
                Organization&apos;s timezone ({timeZoneLabel(orgTimezone)})
              </CommandItem>
              {detected && detected !== value && (
                <CommandItem
                  value={`__detected__ ${detected} this device`}
                  onSelect={() => choose(detected)}
                >
                  <LocateFixed className="size-4" aria-hidden="true" />
                  This device ({timeZoneLabel(detected)})
                </CommandItem>
              )}
            </CommandGroup>
            <CommandGroup heading="All timezones">
              {zones.map((zone) => (
                <CommandItem
                  key={zone}
                  value={`${zone} ${timeZoneLabel(zone)}`}
                  onSelect={() => choose(zone)}
                >
                  <Check className={cn("size-4", value === zone ? "opacity-100" : "opacity-0")} />
                  {timeZoneLabel(zone)}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
