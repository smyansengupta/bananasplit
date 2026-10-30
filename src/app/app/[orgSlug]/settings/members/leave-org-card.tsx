"use client";

import { useEffect, useState, useTransition } from "react";

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
  // The club menu's Leave links here (#leave): open the confirm straight away
  // rather than leaving them to find the button.
  useEffect(() => {
    if (window.location.hash !== "#leave" || isLastOwner) return;
    const id = window.setTimeout(() => setOpen(true));
    return () => window.clearTimeout(id);
  }, [isLastOwner]);

  return (
    <SettingsCard
      id="leave"
      title={`Leave ${orgName}`}
      description={
        isLastOwner
          ? "You're the only owner. Transfer ownership to another member first."
          : "An admin can invite you back."
      }
      footer={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" disabled={isLastOwner}>
              Leave
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Leave {orgName}?</DialogTitle>
              <DialogDescription>
                Your assignments and invitations here go. Your notes and comments stay.
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
