"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { setAttendanceNameAction } from "@/app/app/[orgSlug]/databases/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** A suite-side name for one check-in; the website's row is unchanged. */
export function NameOverrideForm({
  organizationId,
  attendanceId,
  current,
}: {
  organizationId: string;
  attendanceId: string;
  current: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Name to show for this check-in"
          aria-label="Name override"
          maxLength={120}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={pending || value === (current ?? "")}
          onClick={() =>
            start(async () => {
              const r = await setAttendanceNameAction(
                organizationId,
                attendanceId,
                value.trim() || null,
              );
              if (r.error) setError(r.error);
              else {
                setError(null);
                router.refresh();
              }
            })
          }
        >
          Save name
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
