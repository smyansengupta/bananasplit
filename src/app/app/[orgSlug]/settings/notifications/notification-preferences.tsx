"use client";

import { useState, useTransition } from "react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import { setEmailPreference } from "./actions";

const TYPE_LABELS: Record<string, string> = {
  TASK_ASSIGNED: "A task is assigned to me",
  TASK_DUE_SOON: "One of my tasks is due tomorrow",
  EVENT_INVITE: "I'm invited to an event",
  INVITE_ACCEPTED: "Someone accepts my org invite",
};

export function NotificationPreferences({
  types,
  initialPreferences,
}: {
  types: string[];
  initialPreferences: Record<string, boolean>;
}) {
  const [preferences, setPreferences] = useState(initialPreferences);
  const [, startTransition] = useTransition();

  function handleToggle(type: string, enabled: boolean) {
    setPreferences((prev) => ({ ...prev, [type]: enabled }));
    startTransition(async () => {
      await setEmailPreference(type, enabled);
    });
  }

  return (
    <div className="space-y-4">
      {types.map((type) => (
        <div key={type} className="flex items-center justify-between gap-4">
          <Label htmlFor={`pref-${type}`} className="text-sm font-normal">
            {TYPE_LABELS[type] ?? type}
          </Label>
          <Switch
            id={`pref-${type}`}
            checked={preferences[type] !== false}
            onCheckedChange={(checked) => handleToggle(type, checked)}
          />
        </div>
      ))}
    </div>
  );
}
