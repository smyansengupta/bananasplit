"use client";

import { MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

import { changeMemberRole, removeMember, setMemberTitle, transferOwnership } from "./actions";

function roleLabel(role: Role) {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

type DialogKind = "title" | "remove" | "transfer" | null;

/**
 * Row actions on the roster, for OWNER/ADMIN viewers. What is offered
 * mirrors the server rules (the actions re-check everything): ADMINs never
 * see OWNER, nobody changes their own role here, and only an OWNER acts on
 * an OWNER's row.
 */
export function MemberRowActions({
  orgId,
  userId,
  memberName,
  currentRole,
  currentTitle,
  isSelf,
  viewerRole,
  canActOnRow,
  roleOptions,
  canEditTitle,
  canTransfer,
}: {
  orgId: string;
  userId: string;
  memberName: string;
  currentRole: Role;
  currentTitle: string | null;
  isSelf: boolean;
  viewerRole: Role;
  canActOnRow: boolean;
  roleOptions: Role[];
  canEditTitle: boolean;
  canTransfer: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [title, setTitle] = useState(currentTitle ?? "");

  function run(action: () => Promise<{ error?: string } | undefined>, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result?.error) {
        setError(result.error);
      } else {
        onDone?.();
        router.refresh();
      }
    });
  }

  const ownerRowLocked = !isSelf && currentRole === Role.OWNER && viewerRole !== Role.OWNER;
  const menuItems = [
    canEditTitle && { key: "title", label: isSelf ? "Edit my title" : "Edit title" },
    canTransfer && currentRole !== Role.OWNER && { key: "transfer", label: "Transfer ownership" },
    canActOnRow && { key: "remove", label: "Remove from organization" },
  ].filter(Boolean) as { key: Exclude<DialogKind, null>; label: string }[];

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center justify-end gap-2">
        {ownerRowLocked ? (
          <p className="text-muted-foreground text-xs">Only an owner can change an owner.</p>
        ) : canActOnRow ? (
          <Select
            value={currentRole}
            onValueChange={(value) => run(() => changeMemberRole(orgId, userId, value as Role))}
            disabled={isPending}
          >
            <SelectTrigger size="sm" className="w-32" aria-label={`Role for ${memberName}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roleOptions.map((role) => (
                <SelectItem key={role} value={role}>
                  {roleLabel(role)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {menuItems.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`More actions for ${memberName}`}
                disabled={isPending}
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {menuItems.map((item) => (
                <DropdownMenuItem
                  key={item.key}
                  variant={item.key === "remove" ? "destructive" : "default"}
                  onSelect={() => {
                    setError(null);
                    setTitle(currentTitle ?? "");
                    setDialog(item.key);
                  }}
                >
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {error && dialog === null && (
        <p className="text-destructive max-w-xs text-right text-xs">{error}</p>
      )}

      <Dialog open={dialog === "title"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              run(
                () => setMemberTitle(orgId, userId, title),
                () => setDialog(null),
              );
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>Title in this organization</DialogTitle>
              <DialogDescription>
                Shown next to {isSelf ? "your" : `${memberName}'s`} name, e.g. &ldquo;VP
                Growth&rdquo;. It does not change permissions.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5 text-left">
              <Label htmlFor={`title-${userId}`}>Title</Label>
              <Input
                id={`title-${userId}`}
                value={title}
                maxLength={80}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="No title"
              />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving…" : "Save title"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "remove"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {memberName}?</DialogTitle>
            <DialogDescription>
              They lose access right away. Their task assignments and event invitations are removed,
              open tasks they own become unowned, and their org chart position becomes a
              placeholder. Notes and comments they wrote stay.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={isPending}
              aria-label={`Confirm removing ${memberName}`}
              onClick={() =>
                run(
                  () => removeMember(orgId, userId),
                  () => setDialog(null),
                )
              }
            >
              {isPending ? "Removing…" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "transfer"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Make {memberName} an owner?</DialogTitle>
            <DialogDescription>
              {memberName} becomes an owner and you become an admin. Owners can rename the org,
              change its URL, remove integrations, export all data and delete the organization. You
              can&apos;t undo this yourself.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              disabled={isPending}
              onClick={() =>
                run(
                  () => transferOwnership(orgId, userId),
                  () => setDialog(null),
                )
              }
            >
              {isPending ? "Transferring…" : "Transfer ownership"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
