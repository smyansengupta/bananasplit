"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Role } from "@/generated/prisma/enums";
import { SUCCESS_TEXT } from "@/lib/status-tones";

import { inviteMember } from "./actions";

export function InviteForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>(Role.MEMBER);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await inviteMember(orgId, { email, role });
      if (result?.error) {
        setError(result.error);
        return;
      }
      setSuccess("Invite sent.");
      setEmail("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="invite-email">Email</Label>
        <Input
          id="invite-email"
          type="email"
          required
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-64"
          placeholder="name@example.edu"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="invite-role">Role</Label>
        <Select value={role} onValueChange={(value) => setRole(value as Role)}>
          <SelectTrigger id="invite-role" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={Role.ADMIN}>Admin</SelectItem>
            <SelectItem value={Role.TREASURER}>Treasurer</SelectItem>
            <SelectItem value={Role.MEMBER}>Member</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" disabled={isPending}>
        {isPending ? "Sending…" : "Send invite"}
      </Button>
      <p className="w-full text-sm" role="status" aria-live="polite">
        {error && <span className="text-destructive">{error}</span>}
        {success && <span className={SUCCESS_TEXT}>{success}</span>}
      </p>
    </form>
  );
}
