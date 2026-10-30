"use client";

import { type FormEvent, useState, useTransition } from "react";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { SettingsCard } from "../settings-card";
import { scheduleDeletionAction } from "./actions";

export function DeleteCard({
  orgId,
  orgName,
  slug,
  personal = false,
}: {
  orgId: string;
  orgName: string;
  slug: string;
  /** A Personal space: it's yours alone, so the copy says so. */
  personal?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const label = personal ? "Delete Personal space" : `Delete ${orgName}`;

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await scheduleDeletionAction(orgId, typed);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <SettingsCard
      title={personal ? "Delete your Personal space" : "Delete organization"}
      description={
        personal
          ? "Closes now, deleted in 30 days. Your account and organizations aren't affected. Export first."
          : "Closes for everyone now, deleted in 30 days. Owners can cancel until then. Export first."
      }
      footer={
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) {
              setTyped("");
              setError(null);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button variant="destructive">Delete</Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={submit} className="space-y-4">
              <DialogHeader>
                <DialogTitle>
                  {personal ? "Delete your Personal space?" : `Delete ${orgName}?`}
                </DialogTitle>
                <DialogDescription>
                  It closes at once and is deleted for good after 30 days. Type{" "}
                  <span className="text-foreground font-mono">{slug}</span> to confirm.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-1.5">
                <Label htmlFor="confirm-slug">{personal ? "Its URL" : "Organization URL"}</Label>
                <Input
                  id="confirm-slug"
                  autoComplete="off"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={slug}
                />
              </div>
              {error && (
                <p
                  role="alert"
                  className="bg-tint-danger text-tint-danger-foreground rounded-tile p-3 text-sm"
                >
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={isPending || typed.trim() !== slug}
                >
                  {isPending ? "Deleting…" : label}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      }
    />
  );
}
