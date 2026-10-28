"use client";

import { Archive, Lock, ShieldCheck } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  archiveDatabaseAction,
  updateDatabaseSettingsAction,
} from "@/app/app/[orgSlug]/databases/custom-actions";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import type { MemberVisibility } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";
import type { CustomDatabase } from "@/server/databases/custom";

import { notice } from "../styles";

const WHO: { value: MemberVisibility; label: string; hint: string }[] = [
  { value: "MEMBERS", label: "Everyone in the organization", hint: "Every member can open it." },
  { value: "ADMINS", label: "Owners and admins", hint: "Members don't see it at all." },
  { value: "OWNER", label: "Owners only", hint: "For the most sensitive data." },
];

/**
 * A database's name, who can see and edit it, and archiving it. Owners and
 * admins. In Personal it's its owner's alone, so there's no one to choose.
 */
export function DatabaseSettingsDialog({
  orgId,
  orgSlug,
  database,
  open,
  onOpenChange,
  personal = false,
}: {
  orgId: string;
  orgSlug: string;
  database: CustomDatabase;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personal?: boolean;
}) {
  const router = useRouter();
  const [confirmEl, confirm] = useConfirm();
  const [name, setName] = useState(database.name);
  const [description, setDescription] = useState(database.description ?? "");
  const [visibility, setVisibility] = useState<MemberVisibility>(
    database.memberVisibility === "HIDDEN" ? "ADMINS" : database.memberVisibility,
  );
  const [memberCanEdit, setMemberCanEdit] = useState(database.memberCanEdit);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      const result = await updateDatabaseSettingsAction(orgId, database.id, {
        name,
        description: description || null,
        memberVisibility: visibility,
        memberCanEdit: visibility === "MEMBERS" ? memberCanEdit : false,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      toast({ title: "Settings saved" });
      onOpenChange(false);
      router.refresh();
    });
  }

  async function archive() {
    const ok = await confirm({
      title: `Archive ${database.name}?`,
      description: personal
        ? "It disappears from Databases. Nothing is deleted: its rows stay in your data and in your export."
        : "It disappears from Databases for everyone. Nothing is deleted: its rows stay in your organization's data and in the owner's export.",
      confirmLabel: "Archive database",
      run: async () => (await archiveDatabaseAction(orgId, database.id)).error,
    });
    if (!ok) return;
    toast({ title: `${database.name} archived` });
    router.push(`/app/${orgSlug}/databases`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {confirmEl}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Database settings</DialogTitle>
          <DialogDescription>
            Everything here is saved in Bananasplit and only{" "}
            {personal ? "you" : "your organization"} can see it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="db-name">Name</Label>
            <Input
              id="db-name"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="db-description">Description</Label>
            <Textarea
              id="db-description"
              rows={2}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this database is for"
            />
          </div>
          {!personal && (
            <>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Who can see it</legend>
                <div className="grid gap-2">
                  {WHO.map((w) => (
                    <label
                      key={w.value}
                      className={cn(
                        "rounded-tile flex cursor-pointer items-start gap-3 p-3.5 transition-colors",
                        visibility === w.value
                          ? "bg-card ring-foreground ring-2"
                          : "bg-muted/60 hover:bg-muted",
                      )}
                    >
                      <input
                        type="radio"
                        name="db-visibility"
                        value={w.value}
                        checked={visibility === w.value}
                        onChange={() => setVisibility(w.value)}
                        className="accent-primary mt-1"
                      />
                      <span className="space-y-0.5">
                        <span className="flex items-center gap-1.5 text-sm font-medium">
                          {w.value !== "MEMBERS" && (
                            <Lock className="size-3.5" aria-hidden="true" />
                          )}
                          {w.label}
                        </span>
                        <span className="text-muted-foreground block text-xs">{w.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="bg-muted/60 rounded-tile flex items-start justify-between gap-4 p-3.5">
                <div className="space-y-0.5">
                  <Label htmlFor="db-member-edit" className="text-sm font-medium">
                    Members can add and edit rows
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    Off: members only read it. Owners and admins always edit, and only they change
                    fields or delete rows for good.
                  </p>
                </div>
                <Switch
                  id="db-member-edit"
                  checked={visibility === "MEMBERS" && memberCanEdit}
                  disabled={visibility !== "MEMBERS"}
                  onCheckedChange={setMemberCanEdit}
                />
              </div>
              <p className="text-muted-foreground flex gap-2 text-xs">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                The database itself enforces these: other organizations can never read your data,
                and members can&apos;t open what&apos;s limited to admins, whatever page or link
                they use.
              </p>
            </>
          )}
          {error && (
            <p className={notice.error} role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="destructive" onClick={() => void archive()}>
            <Archive aria-hidden="true" />
            Archive database
          </Button>
          <span className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={pending || !name.trim()}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
