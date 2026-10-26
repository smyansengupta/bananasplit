"use client";

import { chipClass } from "@/components/ui/segmented";
import { MAX_REMINDERS, REMINDER_CHOICES, reminderLabel } from "@/lib/meetings/reminders";
import { cn } from "@/lib/utils";

/**
 * When a meeting reminds people, as toggles (docs/features/meetings.md).
 *
 * One toggle for each time worth a button (REMINDER_CHOICES). A meeting can
 * hold any other time in range, though, and a picker that hid it could neither
 * show it nor take it off: so a time in `value` that is not a choice gets a
 * pressed toggle of its own, in its place by how far ahead it is.
 *
 * At most MAX_REMINDERS, which the database enforces too. Once that many are
 * chosen the rest are disabled, and a pressed one can still be turned off.
 * `onChange` always gets the list latest-first, the order everything else
 * reads.
 */
export function ReminderPicker({
  id,
  value,
  onChange,
  disabled = false,
}: {
  id?: string;
  value: number[];
  onChange: (next: number[]) => void;
  disabled?: boolean;
}) {
  const chosen = new Set(value);
  const offered = [...new Set([...REMINDER_CHOICES, ...value])].sort((a, b) => b - a);
  const full = chosen.size >= MAX_REMINDERS;

  function toggle(minutes: number) {
    const next = new Set(chosen);
    if (!next.delete(minutes)) next.add(minutes);
    onChange([...next].sort((a, b) => b - a));
  }

  return (
    <div id={id} role="group" aria-label="Reminders" className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {offered.map((minutes) => {
          const on = chosen.has(minutes);
          return (
            <button
              key={minutes}
              type="button"
              aria-pressed={on}
              disabled={disabled || (!on && full)}
              onClick={() => toggle(minutes)}
              className={cn(
                chipClass(on),
                "h-8 px-3 text-[13px] disabled:cursor-not-allowed disabled:opacity-50",
                !on && "disabled:hover:bg-transparent",
              )}
            >
              {reminderLabel(minutes)}
            </button>
          );
        })}
      </div>
      {value.length === 0 && <p className="text-muted-foreground text-xs">No reminders</p>}
    </div>
  );
}
