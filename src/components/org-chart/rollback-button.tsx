"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { rollbackAction } from "@/app/app/[orgSlug]/org-chart/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** Restore: copies the version forward as a new version and publishes it. */
export function RollbackButton({
  orgId,
  orgSlug,
  versionId,
  number,
}: {
  orgId: string;
  orgSlug: string;
  versionId: string;
  number: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <RotateCcw className="size-4" aria-hidden="true" />
          Restore
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restore version {number}?</DialogTitle>
          <DialogDescription>
            Version {number} is copied forward as a new version and published. The current chart
            stays in the history, so you can switch back. Members who have left since show as
            placeholders.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await rollbackAction(orgId, versionId);
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                setOpen(false);
                router.push(`/app/${orgSlug}/org-chart`);
                router.refresh();
              })
            }
          >
            {pending ? "Restoring…" : `Restore version ${number}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
