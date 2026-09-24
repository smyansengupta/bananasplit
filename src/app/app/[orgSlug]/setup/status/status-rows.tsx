"use client";

import { useRouter } from "next/navigation";
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
import { setupStep, type SetupStepId } from "@/server/setup/catalog";

import { disconnectSetupStepAction, type SetupResult } from "../actions";

/**
 * Disconnecting, on the status page. Behind a confirmation, because for
 * every provider except Google it deletes the stored credential outright
 * and the club has to fetch a new one.
 *
 * Testing and reconnecting live in ../step-controls (TestButton): the same
 * control the flow uses, so a failure reads the same in both places.
 */
export function DisconnectButton({
  orgId,
  step,
  canRemove,
}: {
  orgId: string;
  step: SetupStepId;
  canRemove: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<SetupResult | null>(null);
  const [isPending, start] = useTransition();
  const isGoogle = step === "calendar";

  if (!canRemove && !isGoogle) {
    return (
      <span className="text-muted-foreground self-center text-xs">
        Only an owner can remove this.
      </span>
    );
  }

  return (
    <div className="space-y-1">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" className="text-destructive" disabled={isPending}>
            Disconnect
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect {setupStep(step).title}?</DialogTitle>
            <DialogDescription>
              {isGoogle
                ? "Access is revoked at Google straight away and events stop mirroring. Events already on the calendar are left alone. You can connect again at any time."
                : "The stored credential is deleted. Nothing that has already been pulled in is removed, but it stops updating, and you will need the credential again to reconnect."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() =>
                start(async () => {
                  const r = await disconnectSetupStepAction(orgId, step);
                  setResult(r);
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              {isPending ? "Disconnecting…" : "Disconnect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {result ? (
        <p
          role="status"
          className={result.ok ? "text-muted-foreground text-xs" : "text-destructive text-xs"}
        >
          {result.ok ? (result.message ?? "Disconnected.") : result.error}
        </p>
      ) : null}
    </div>
  );
}
