"use client";

import { Building2, Check, ChevronsUpDown, LocateFixed } from "lucide-react";
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
import { listTimeZones, timeZoneLabel } from "@/lib/profile/timezone";
import { cn } from "@/lib/utils";

/**
 * A searchable timezone picker (the profile's pattern: a combobox over every
 * IANA zone, built only when opened), with shortcuts to the organization's
 * zone and this device's. Always shows the current value, including zones a
 * runtime leaves out of its list ("UTC" in Chrome).
 */
export function TimeZoneCombobox({
  id,
  value,
  onChange,
  orgTimeZone,
  deviceTimeZone,
  "aria-describedby": describedBy,
}: {
  id?: string;
  value: string;
  onChange: (zone: string) => void;
  orgTimeZone?: string;
  deviceTimeZone?: string;
  "aria-describedby"?: string;
}) {
  const [open, setOpen] = useState(false);
  const zones = useMemo(() => (open ? listTimeZones() : []), [open]);

  function choose(zone: string) {
    onChange(zone);
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
          aria-describedby={describedBy}
          className="w-full justify-between font-normal"
        >
          <span className="min-w-0 truncate">{timeZoneLabel(value)}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search timezones…" />
          <CommandList>
            <CommandEmpty>No timezone found.</CommandEmpty>
            {(orgTimeZone || deviceTimeZone) && (
              <CommandGroup>
                {orgTimeZone && (
                  <CommandItem
                    value={`__org__ ${orgTimeZone} organization`}
                    onSelect={() => choose(orgTimeZone)}
                  >
                    <Building2 className="size-4" aria-hidden="true" />
                    Organization&apos;s ({timeZoneLabel(orgTimeZone)})
                  </CommandItem>
                )}
                {deviceTimeZone && deviceTimeZone !== orgTimeZone && (
                  <CommandItem
                    value={`__device__ ${deviceTimeZone} this device`}
                    onSelect={() => choose(deviceTimeZone)}
                  >
                    <LocateFixed className="size-4" aria-hidden="true" />
                    This device ({timeZoneLabel(deviceTimeZone)})
                  </CommandItem>
                )}
              </CommandGroup>
            )}
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
