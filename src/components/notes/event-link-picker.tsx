"use client";

import { CalendarDays } from "@/components/icons";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface EventOption {
  id: string;
  title: string;
  startsAt: Date;
}

const EVENT_DAY = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

export function EventLinkPicker({
  events,
  value,
  onChange,
  disabled,
}: {
  events: EventOption[];
  value: string | null;
  onChange: (eventId: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value ?? "none"}
      onValueChange={(v) => onChange(v === "none" ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger size="sm" className="w-auto max-w-72" aria-label="Linked event">
        <CalendarDays className="text-muted-foreground size-4" aria-hidden="true" />
        <SelectValue placeholder="Link an event" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">No linked event</SelectItem>
        {events.map((event) => (
          <SelectItem key={event.id} value={event.id}>
            <span className="truncate">{event.title}</span>
            <span className="text-muted-foreground ms-2 shrink-0 text-xs">
              {EVENT_DAY.format(event.startsAt)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
