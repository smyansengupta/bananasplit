"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { saveAvailabilityStep } from "@/app/onboarding/profile/actions";
import { AvailabilityEditor } from "@/components/onboarding/availability-editor";
import type { Availability } from "@/lib/availability";

import { SettingsCard } from "../settings/settings-card";

/** Profile > Availability: the onboarding A5 editor, editable. Saves itself as you change it. */
export function AvailabilityForm({ initial }: { initial: Availability }) {
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const lastSaved = useRef(JSON.stringify(initial));

  function save(snapshot: Availability) {
    setStatus(null);
    start(async () => {
      const result = await saveAvailabilityStep(snapshot);
      setStatus(
        result.ok
          ? { ok: true, text: "Saved" }
          : {
              ok: false,
              text: Object.values(result.fieldErrors)[0] ?? "Couldn't save. Try again.",
            },
      );
    });
  }

  useEffect(() => {
    const json = JSON.stringify(value);
    if (json === lastSaved.current) return;
    const timer = setTimeout(() => {
      lastSaved.current = json;
      save(value);
    }, 700);
    return () => clearTimeout(timer);
  }, [value]);

  return (
    <SettingsCard
      title="Availability"
      description="Teammates see busy, never why."
      status={
        <span
          aria-live="polite"
          className={status?.ok === false ? "text-destructive" : "text-success"}
        >
          {pending ? "Saving" : status?.text}
        </span>
      }
    >
      <div className="max-w-md">
        <AvailabilityEditor value={value} onChange={setValue} />
      </div>
    </SettingsCard>
  );
}
