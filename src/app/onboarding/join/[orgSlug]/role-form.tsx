"use client";

import { BadgeCheck } from "@/components/icons";
import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";

import { pill } from "@/components/brand/pill";
import {
  initialRoleValue,
  RolePicker,
  roleTitle,
  type RoleValue,
} from "@/components/onboarding/role-picker";
import { FieldError, FieldLabel } from "@/components/onboarding/step-fields";

import { saveClubRoleAction } from "../actions";

/** The role picker, the availability line, then Continue into the club (or Skip). */
export function RoleForm({
  orgSlug,
  clubName,
  initialTitle,
  availability,
}: {
  orgSlug: string;
  clubName: string;
  initialTitle: string | null;
  availability: ReactNode;
}) {
  const [role, setRole] = useState<RoleValue>(() => initialRoleValue(initialTitle));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await saveClubRoleAction(orgSlug, { title: roleTitle(role) });
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-1.5">
        <FieldLabel id="club-role-label" icon={BadgeCheck}>
          Your role
        </FieldLabel>
        <RolePicker value={role} onChange={setRole} labelledBy="club-role-label" />
      </div>
      {availability}
      <FieldError message={error ?? undefined} />
      <div className="flex flex-wrap items-center justify-end gap-5">
        <Link
          href={`/app/${orgSlug}`}
          className="text-muted-foreground hover:text-foreground text-[15px] font-semibold"
        >
          Skip
        </Link>
        <button type="button" onClick={submit} disabled={pending} className={pill()}>
          {pending ? "Saving…" : `Go to ${clubName}`}
        </button>
      </div>
    </div>
  );
}
