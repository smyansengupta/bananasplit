"use client";

import { CalendarDays } from "lucide-react";

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
      <SelectTrigger className="w-56">
        <CalendarDays className="text-muted-foreground size-4" aria-hidden="true" />
        <SelectValue placeholder="Link an event" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">No linked event</SelectItem>
        {events.map((event) => (
          <SelectItem key={event.id} value={event.id}>
            {event.title} — {event.startsAt.toLocaleDateString()}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
