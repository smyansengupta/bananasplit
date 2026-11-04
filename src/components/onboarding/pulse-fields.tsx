"use client";

import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PULSE_AUDIENCES, PULSE_DAYS, PULSE_HOURS, type PulseSettings } from "@/lib/pulse/settings";

/**
 * The weekly pulse's fields (redesign guide 15.2), shared by the club
 * setup step and Admin panel › Weekly pulse: the day as a segmented
 * control (Mon to Sun), the time, who gets it, and the two channels.
 */
export function PulseFields({
  value,
  onChange,
  disabled,
}: {
  value: PulseSettings;
  onChange: (next: PulseSettings) => void;
  disabled?: boolean;
}) {
  const set = (patch: Partial<PulseSettings>) => onChange({ ...value, ...patch });
  return (
    // min-w-0: a fieldset is otherwise as wide as its widest row, past a phone's edge.
    <fieldset
      disabled={disabled}
      className="flex flex-col gap-6 disabled:opacity-60 max-md:min-w-0"
    >
      <div className="flex flex-col gap-2">
        <span id="pulse-day-label" className="text-sm font-medium">
          Day
        </span>
        <div className="-mx-1 max-w-full overflow-x-auto px-1 pb-1">
          <Segmented
            label="Pulse day"
            value={String(value.pulseDay)}
            onSelect={(v) => set({ pulseDay: Number(v) })}
            options={PULSE_DAYS.map((d) => ({ value: String(d.value), label: d.label }))}
            className="max-md:flex max-md:w-full max-md:[&>button]:flex-1 max-md:[&>button]:justify-center max-md:[&>button]:px-0"
          />
        </div>
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="pulse-time">Time</Label>
          <Select
            value={String(value.pulseHourLocal)}
            onValueChange={(v) => set({ pulseHourLocal: Number(v) })}
          >
            <SelectTrigger id="pulse-time" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PULSE_HOURS.map((h) => (
                <SelectItem key={h.value} value={String(h.value)}>
                  {h.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Who gets it</span>
          <Segmented
            label="Pulse audience"
            value={value.pulseAudience}
            onSelect={(v) => set({ pulseAudience: v as PulseSettings["pulseAudience"] })}
            options={PULSE_AUDIENCES.map((a) => ({
              value: a.value,
              label: a.label,
              title: a.hint,
            }))}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-7 gap-y-3">
        <label className="inline-flex items-center gap-2.5 text-sm font-medium">
          <Switch
            checked={value.pulseInApp}
            onCheckedChange={(on) => set({ pulseInApp: on })}
            aria-label="Show in the app"
          />
          In the app
        </label>
        <label className="inline-flex items-center gap-2.5 text-sm font-medium">
          <Switch
            checked={value.pulseEmail}
            onCheckedChange={(on) => set({ pulseEmail: on })}
            aria-label="Send by email"
          />
          Email
        </label>
      </div>
    </fieldset>
  );
}
