"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { SettingsCard } from "../settings-card";
import { leaveOrg } from "./actions";

export function LeaveOrgCard({
  orgId,
  orgName,
  isLastOwner,
}: {
  orgId: string;
  orgName: string;
  isLastOwner: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <SettingsCard
      id="leave"
      title={`Leave ${orgName}`}
      description={
        isLastOwner
          ? "You're the only owner. Transfer ownership to another member first."
          : "You lose access to this organization. An admin can invite you again."
      }
      footer={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" disabled={isLastOwner}>
              Leave organization
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Leave {orgName}?</DialogTitle>
              <DialogDescription>
                Your task assignments and event invitations here are removed and open tasks you own
                become unowned. Notes and comments you wrote stay.
              </DialogDescription>
            </DialogHeader>
            {error && (
              <p
                role="alert"
                className="bg-tint-danger text-tint-danger-foreground rounded-tile p-3 text-sm"
              >
                {error}
              </p>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    setError(null);
                    const result = await leaveOrg(orgId);
                    if (result?.error) setError(result.error);
                  })
                }
              >
                {isPending ? "Leaving…" : `Leave ${orgName}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    />
  );
}
