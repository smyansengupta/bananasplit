"use client";

import { Loader2, Trash2 } from "lucide-react";
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
} from "@/components/ui/dialog";

import { deletePoll } from "../actions";

/** Delete, for the poll's creator or an owner/admin (deletePoll checks again). */
export function DeletePollButton({
  orgId,
  orgSlug,
  pollId,
  title,
  scheduled,
}: {
  orgId: string;
  orgSlug: string;
  pollId: string;
  title: string;
  /** A scheduled poll's event stays on the calendar. */
  scheduled: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deletePoll(orgId, pollId);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push(`/app/${orgSlug}/calendar/polls`);
    });
  }

  return (
    <>
      <Button variant="outline" size="icon" aria-label="Delete poll" onClick={() => setOpen(true)}>
        <Trash2 className="size-4" />
      </Button>
      <Dialog open={open} onOpenChange={(next) => !isPending && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{title}&rdquo;?</DialogTitle>
            <DialogDescription>
              Everyone&apos;s answers are deleted and the link stops working.
              {scheduled && " The event it scheduled stays on the calendar."}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
              {isPending && <Loader2 aria-hidden className="size-4 animate-spin" />}
              Delete poll
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
