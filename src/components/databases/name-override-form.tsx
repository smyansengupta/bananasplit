"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { setAttendanceNameAction } from "@/app/app/[orgSlug]/databases/actions";
import { SavedMark, useSaveOnChange } from "@/components/ui/autosave";
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
  const { status, error, save } = useSaveOnChange(
    async (name: string) => {
      const r = await setAttendanceNameAction(organizationId, attendanceId, name.trim() || null);
      if (r.error) return r.error;
      router.refresh();
    },
    { initial: current ?? "" },
  );
  return (
    <div className="space-y-1">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void save(value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save(value);
        }}
        placeholder="Name to show for this check-in"
        aria-label="Name override"
        maxLength={120}
      />
      <SavedMark status={status} error={error} />
    </div>
  );
}
