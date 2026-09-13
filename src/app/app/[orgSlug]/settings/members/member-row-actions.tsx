"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Role } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { changeMemberRole, removeMember } from "./actions";

const ROLE_OPTIONS = [Role.OWNER, Role.ADMIN, Role.TREASURER, Role.MEMBER];

function roleLabel(role: Role) {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

export function MemberRowActions({
  orgId,
  userId,
  currentRole,
  memberName,
}: {
  orgId: string;
  userId: string;
  currentRole: Role;
  memberName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  function handleRoleChange(value: string) {
    setError(null);
    startTransition(async () => {
      const result = await changeMemberRole(orgId, userId, value as Role);
      if (result?.error) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  function handleRemove() {
    setError(null);
    startTransition(async () => {
      const result = await removeMember(orgId, userId);
      if (result?.error) {
        setError(result.error);
      } else {
        setConfirmingRemove(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Select value={currentRole} onValueChange={handleRoleChange} disabled={isPending}>
          <SelectTrigger size="sm" className="w-32" aria-label={`Role for ${memberName}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLE_OPTIONS.map((role) => (
              <SelectItem key={role} value={role}>
                {roleLabel(role)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {confirmingRemove ? (
          <>
            <Button
              size="sm"
              variant="destructive"
              disabled={isPending}
              onClick={handleRemove}
              aria-label={`Confirm removing ${memberName}`}
            >
              Confirm
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={isPending}
              onClick={() => setConfirmingRemove(false)}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => setConfirmingRemove(true)}
            aria-label={`Remove ${memberName}`}
          >
            Remove
          </Button>
        )}
      </div>
      {error && <p className="text-destructive max-w-xs text-right text-xs">{error}</p>}
    </div>
  );
}
