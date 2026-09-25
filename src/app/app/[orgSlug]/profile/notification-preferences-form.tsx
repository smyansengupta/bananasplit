"use client";

import { useRef, useState } from "react";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import type { NotificationType } from "@/generated/prisma/enums";
import {
  applyNotificationPreferencesPatch,
  NOTIFICATION_GROUP_LABELS,
  NOTIFICATION_TYPE_META,
  REMINDER_LEAD_DAYS_MAX,
  type NotificationGroup,
  type NotificationPreferences,
  type NotificationPreferencesPatch,
} from "@/lib/notifications/preferences";
import { timeZoneLabel } from "@/lib/profile/timezone";

import { saveNotificationPreferences } from "./actions";

const LEAD_OPTIONS = [0, 1, 2, 3, 5, 7, 14];

function hourLabel(hour: number): string {
  const suffix = hour < 12 ? "AM" : "PM";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:00 ${suffix}`;
}

function leadLabel(days: number): string {
  if (days === 0) return "On the due date";
  if (days === 7) return "1 week before";
  if (days === 14) return "2 weeks before";
  return `${days} day${days === 1 ? "" : "s"} before`;
}

const GROUPS: NotificationGroup[] = ["tasks", "events", "org"];
const TYPES_BY_GROUP = GROUPS.map((group) => ({
  group,
  types: (Object.entries(NOTIFICATION_TYPE_META) as [NotificationType, (typeof NOTIFICATION_TYPE_META)[keyof typeof NOTIFICATION_TYPE_META]][])
    .filter(([, meta]) => meta.group === group)
    .map(([type, meta]) => ({ type, ...meta })),
}));

/**
 * Email preferences (v2): a switch per notification type, the daily digest
 * with its hour, and how many days before a due date the reminder comes.
 * Each change saves at once and rolls back if the save fails. In-app
 * notifications (the bell) are not affected.
 */
export function NotificationPreferencesForm({
  initial,
  effectiveTimezone,
  followsOrg,
}: {
  initial: NotificationPreferences;
  effectiveTimezone: string;
  followsOrg: boolean;
}) {
  const [prefs, setPrefs] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(0);
  // The last value the server confirmed: where a failed change rolls back to.
  const confirmed = useRef(initial);
  const inFlight = useRef(0);

  async function save(patch: NotificationPreferencesPatch) {
    setError(null);
    setPrefs((current) => applyNotificationPreferencesPatch(current, patch));
    inFlight.current += 1;
    setSaving(inFlight.current);
    try {
      const result = await saveNotificationPreferences(patch);
      if (result.ok) {
        confirmed.current = result.preferences;
        // The server applies changes in order; once the last one is back,
        // show exactly what it stored.
        if (inFlight.current === 1) setPrefs(result.preferences);
      } else {
        setError(result.error);
        setPrefs(confirmed.current);
      }
    } catch {
      setError("Couldn't save that change. Check your connection and try again.");
      setPrefs(confirmed.current);
    } finally {
      inFlight.current -= 1;
      setSaving(inFlight.current);
    }
  }

  const leadOptions = LEAD_OPTIONS.includes(prefs.reminderLeadDays)
    ? LEAD_OPTIONS
    : [...LEAD_OPTIONS, prefs.reminderLeadDays].sort((a, b) => a - b);

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">
        These choose what is also emailed to you. Everything still shows in the notification bell.
      </p>

      {TYPES_BY_GROUP.map(({ group, types }) => (
        <fieldset key={group} className="space-y-3">
          <legend className="mb-2 text-sm font-medium">{NOTIFICATION_GROUP_LABELS[group]}</legend>
          {types.map(({ type, label, audience }) => (
            <div key={type} className="flex items-center justify-between gap-4">
              <Label htmlFor={`pref-${type}`} className="flex flex-col items-start gap-0.5 font-normal">
                <span>{label}</span>
                {audience && <span className="text-muted-foreground text-xs">{audience}</span>}
              </Label>
              <Switch
                id={`pref-${type}`}
                checked={prefs.types[type] !== false}
                onCheckedChange={(checked) => save({ types: { [type]: checked } })}
              />
            </div>
          ))}
        </fieldset>
      ))}

      <Separator />

      <fieldset className="space-y-4">
        <legend className="mb-2 text-sm font-medium">Daily digest and reminders</legend>

        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="pref-digest" className="flex flex-col items-start gap-0.5 font-normal">
            <span>Email me a daily digest of my tasks</span>
            <span className="text-muted-foreground text-xs">
              Overdue, due today, due this week, newly assigned and blocked.
            </span>
          </Label>
          <Switch
            id="pref-digest"
            checked={prefs.digest.enabled}
            onCheckedChange={(checked) => save({ digest: { enabled: checked } })}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pref-digest-hour">Send the digest at</Label>
            <Select
              value={String(prefs.digest.hourLocal)}
              onValueChange={(v) => save({ digest: { hourLocal: Number(v) } })}
              disabled={!prefs.digest.enabled}
            >
              <SelectTrigger id="pref-digest-hour" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 24 }, (_, hour) => (
                  <SelectItem key={hour} value={String(hour)}>
                    {hourLabel(hour)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pref-lead">Due-date reminder</Label>
            <Select
              value={String(prefs.reminderLeadDays)}
              onValueChange={(v) => save({ reminderLeadDays: Number(v) })}
            >
              <SelectTrigger id="pref-lead" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {leadOptions
                  .filter((d) => d >= 0 && d <= REMINDER_LEAD_DAYS_MAX)
                  .map((days) => (
                    <SelectItem key={days} value={String(days)}>
                      {leadLabel(days)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <p className="text-muted-foreground text-xs">
          Times are in {timeZoneLabel(effectiveTimezone)}
          {followsOrg ? " (your organization's timezone; change yours under Details)" : " (your timezone)"}
          .
        </p>
      </fieldset>

      <p aria-live="polite" className="min-h-5 text-sm">
        {error ? (
          <span className="text-destructive">{error}</span>
        ) : saving > 0 ? (
          <span className="text-muted-foreground">Saving…</span>
        ) : null}
      </p>
    </div>
  );
}
