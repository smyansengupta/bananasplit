"use client";

import { useState, useTransition } from "react";

import { PulseFields } from "@/components/onboarding/pulse-fields";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toaster";
import { describePulseSchedule, type PulseSettings } from "@/lib/pulse/settings";

import { savePulseSettingsAction } from "./actions";

export function PulseSettingsForm({
  orgId,
  initial,
  canEdit,
}: {
  orgId: string;
  initial: PulseSettings;
  canEdit: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(value) !== JSON.stringify(initial);

  return (
    <form
      className="bg-card edge ring-foreground/6 rounded-card space-y-7 p-[18px] ring-1 sm:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const result = await savePulseSettingsAction(orgId, value);
          if (!result.ok) setError(result.error ?? "That couldn't be saved.");
          else toast({ title: "Weekly pulse saved", tone: "success" });
        });
      }}
    >
      <label className="flex items-start justify-between gap-4">
        <span>
          <span className="heading block text-[17px]">Send the weekly pulse</span>
          <span className="text-muted-foreground mt-1 block text-sm">
            {value.pulseEnabled
              ? `${describePulseSchedule(value)}, in the organization's time zone.`
              : "Off: no recap goes out, and the Overview card shows the trend only."}
          </span>
        </span>
        <Switch
          checked={value.pulseEnabled}
          disabled={!canEdit}
          onCheckedChange={(on) => setValue({ ...value, pulseEnabled: on })}
          aria-label="Send the weekly pulse"
        />
      </label>
      <PulseFields value={value} onChange={setValue} disabled={!canEdit || !value.pulseEnabled} />
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {canEdit && (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending || !dirty}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
          {dirty && (
            <Button type="button" variant="ghost" onClick={() => setValue(initial)}>
              Cancel
            </Button>
          )}
        </div>
      )}
    </form>
  );
}
