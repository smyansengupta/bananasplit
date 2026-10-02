"use client";

import { useState, useTransition } from "react";

import { saveAvailabilityStep } from "@/app/onboarding/profile/actions";
import { AvailabilityEditor } from "@/components/onboarding/availability-editor";
import { Button } from "@/components/ui/button";
import type { Availability } from "@/lib/availability";

/** Profile > When you can't meet: the onboarding A5 editor, editable. */
export function AvailabilityForm({ initial }: { initial: Availability }) {
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setStatus(null);
    start(async () => {
      const result = await saveAvailabilityStep(value);
      setStatus(
        result.ok
          ? { ok: true, text: "Saved." }
          : {
              ok: false,
              text: Object.values(result.fieldErrors)[0] ?? "Couldn't save. Try again.",
            },
      );
    });
  }

  return (
    <div className="max-w-md space-y-4">
      <AvailabilityEditor value={value} onChange={setValue} />
      <div className="flex items-center gap-3">
        <Button type="button" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <span
          aria-live="polite"
          className={
            status?.ok === false ? "text-destructive text-sm" : "text-muted-foreground text-sm"
          }
        >
          {status?.text}
        </span>
      </div>
    </div>
  );
}
