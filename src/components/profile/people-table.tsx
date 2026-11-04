"use client";

import { Check, Copy, Crown, Mail, RefreshCw, Trash2, X } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  changeMemberRole,
  removeMember,
  resendExpiredInvitations,
  resendInvitation,
  revokeInvitation,
  setMemberTitle,
  transferOwnership,
} from "@/app/app/[orgSlug]/settings/members/actions";
import { SavedMark, useSaveOnChange } from "@/components/ui/autosave";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { FieldSelect } from "@/components/ui/field-select";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toaster";
import { UserAvatar } from "@/components/user-avatar";
import { Role } from "@/generated/prisma/enums";
import { canActOnMember } from "@/lib/auth/member-roles";
import { assignableRoles } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";
import type { DirectoryPerson } from "@/server/profiles/directory";

import { ROLE_LABELS } from "./person-profile";

/** An invite not yet accepted, shown as an "Invited" row at the end of the table. */
export interface InvitedRow {
  id: string;
  email: string;
  role: string;
  /** ISO string. */
  expiresAt: string;
  expired: boolean;
}

export interface RosterAccess {
  /** The viewer's role in the organization. */
  role: Role;
  /** OWNER/ADMIN: roles, titles, removing. */
  canManage: boolean;
  canInvite: boolean;
  /** OWNER: hand ownership to someone else. */
  canTransfer: boolean;
}

const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

async function copyText(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast({ title: done, tone: "success" });
  } catch {
    toast({ title: "Couldn't copy. Select it and copy instead.", tone: "error" });
  }
}

/**
 * The roster (Admin > Members): the one place membership is managed. Everyone sees name, email (when
 * the viewer may), title, role and when they joined; a click on a name
 * opens the profile, a click on an email copies it, and "Copy N emails"
 * copies everyone in view. Owners and admins edit roles and titles in
 * place (saved as they change), pick several to set a role at once, remove
 * someone, and see the invites still waiting as "Invited" rows. What's
 * offered mirrors the server rules (the actions re-check everything):
 * admins never touch an owner's row and nobody changes their own role here.
 */
export function PeopleTable({
  orgId,
  viewerId,
  people,
  emails,
  invites,
  access,
  onSelect,
}: {
  orgId: string;
  viewerId: string;
  people: DirectoryPerson[];
  /** userId → email, only what the viewer may see. */
  emails: Record<string, string>;
  invites: InvitedRow[];
  access: RosterAccess;
  onSelect: (id: string) => void;
}) {
  const router = useRouter();
  const [confirmEl, confirm] = useConfirm();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const roleOptions = assignableRoles(access.role);
  const selectable = useMemo(
    () =>
      access.canManage
        ? people.filter((p) => p.id !== viewerId && canActOnMember(access.role, p.role))
        : [],
    [people, viewerId, access],
  );
  const visibleEmails = people.map((p) => emails[p.id]).filter((e): e is string => Boolean(e));
  const allSelected = selectable.length > 0 && selectable.every((p) => selected.has(p.id));
  const expired = invites.filter((i) => i.expired).length;

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function setRoleForSelected(role: Role) {
    setBulkBusy(true);
    const ids = [...selected];
    const errors: string[] = [];
    for (const id of ids) {
      const result = await changeMemberRole(orgId, id, role);
      if (result?.error) errors.push(result.error);
    }
    setBulkBusy(false);
    setSelected(new Set());
    router.refresh();
    if (errors.length > 0)
      toast({
        title: `${ids.length - errors.length} of ${ids.length} changed`,
        description: errors[0],
        tone: "error",
      });
    else toast({ title: `${ids.length} set to ${ROLE_LABELS[role]}`, tone: "success" });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-10 flex-wrap items-center gap-2">
        {selected.size > 0 ? (
          <>
            <span className="text-sm font-semibold">{selected.size} selected</span>
            <span className="text-muted-foreground text-sm">Set role</span>
            <fieldset disabled={bulkBusy} className="max-w-full overflow-x-auto">
              <Segmented
                label="Set role for the selected people"
                value=""
                onSelect={(v) => void setRoleForSelected(v as Role)}
                options={roleOptions
                  .filter((r) => r !== Role.OWNER)
                  .map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
              />
            </fieldset>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set())}
              aria-label="Clear the selection"
            >
              <X aria-hidden="true" />
              Clear
            </Button>
          </>
        ) : (
          visibleEmails.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                void copyText(
                  visibleEmails.join(", "),
                  `${visibleEmails.length} ${visibleEmails.length === 1 ? "email" : "emails"} copied`,
                )
              }
            >
              <Copy aria-hidden="true" />
              Copy {visibleEmails.length} {visibleEmails.length === 1 ? "email" : "emails"}
            </Button>
          )
        )}
        {access.canInvite && expired > 0 && selected.size === 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={async () => {
              const result = await resendExpiredInvitations(orgId);
              if (result.error) toast({ title: result.error, tone: "error" });
              else {
                toast({ title: `${result.count ?? expired} resent`, tone: "success" });
                router.refresh();
              }
            }}
          >
            <RefreshCw aria-hidden="true" />
            Resend {expired} expired
          </Button>
        )}
      </div>

      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[820px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-muted-foreground text-left text-[13px]">
              {access.canManage && (
                <th className="w-10 pb-2 font-medium">
                  {selectable.length > 0 && (
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={(on) =>
                        setSelected(on ? new Set(selectable.map((p) => p.id)) : new Set())
                      }
                      aria-label="Select everyone"
                    />
                  )}
                </th>
              )}
              <th className="pb-2 font-medium">Name</th>
              {visibleEmails.length > 0 && <th className="pb-2 font-medium">Email</th>}
              <th className="pb-2 font-medium">Title</th>
              <th className="pb-2 font-medium">Role</th>
              <th className="pb-2 font-medium">Joined</th>
              {access.canManage && (
                <th className="pb-2">
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <PersonLine
                key={p.id}
                orgId={orgId}
                person={p}
                email={emails[p.id]}
                showEmailColumn={visibleEmails.length > 0}
                isSelf={p.id === viewerId}
                access={access}
                roleOptions={roleOptions}
                selected={selected.has(p.id)}
                selectable={selectable.some((s) => s.id === p.id)}
                onToggle={() => toggle(p.id)}
                onSelect={onSelect}
                confirm={confirm}
              />
            ))}
            {invites.map((i) => (
              <InviteLine
                key={i.id}
                orgId={orgId}
                invite={i}
                manage={access.canManage}
                showEmailColumn={visibleEmails.length > 0}
              />
            ))}
          </tbody>
        </table>
      </div>
      {confirmEl}
    </div>
  );
}

function PersonLine({
  orgId,
  person,
  email,
  showEmailColumn,
  isSelf,
  access,
  roleOptions,
  selected,
  selectable,
  onToggle,
  onSelect,
  confirm,
}: {
  orgId: string;
  person: DirectoryPerson;
  email: string | undefined;
  showEmailColumn: boolean;
  isSelf: boolean;
  access: RosterAccess;
  roleOptions: Role[];
  selected: boolean;
  selectable: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  confirm: ReturnType<typeof useConfirm>[1];
}) {
  const router = useRouter();
  const name = person.name ?? email ?? "Member";
  const actOnRow = access.canManage && !isSelf && canActOnMember(access.role, person.role);
  const canEditTitle = isSelf || actOnRow;
  const [title, setTitle] = useState(person.title ?? "");
  const [role, setRole] = useState(person.role);
  const titleSave = useSaveOnChange(
    async (next: string) => {
      const result = await setMemberTitle(orgId, person.id, next);
      if (!result?.error) router.refresh();
      return result?.error ?? null;
    },
    { initial: person.title ?? "" },
  );
  const roleSave = useSaveOnChange(
    async (next: Role) => {
      const result = await changeMemberRole(orgId, person.id, next);
      if (result?.error) {
        setRole(person.role);
        return result.error;
      }
      router.refresh();
      return null;
    },
    { initial: person.role },
  );

  const cell = "border-border/60 border-t py-2.5 pr-3 align-middle";
  return (
    <tr className={cn("group", selected && "bg-tint-accent/60")}>
      {access.canManage && (
        <td className={cn(cell, "w-10")}>
          {selectable && (
            <Checkbox checked={selected} onCheckedChange={onToggle} aria-label={`Select ${name}`} />
          )}
        </td>
      )}
      <td className={cell}>
        <button
          type="button"
          onClick={() => onSelect(person.id)}
          className="focus-glow flex min-w-0 items-center gap-2.5 rounded-full text-left outline-none"
        >
          <UserAvatar user={person} size="sm" />
          <span className="min-w-0 font-semibold break-words hover:underline">
            {name}
            {isSelf && <span className="text-muted-foreground ml-1 font-normal">(you)</span>}
          </span>
        </button>
      </td>
      {showEmailColumn && (
        <td className={cn(cell, "max-w-56")}>
          {email && (
            <button
              type="button"
              onClick={() => void copyText(email, "Email copied")}
              title="Copy"
              className="text-muted-foreground hover:text-foreground focus-glow inline-flex max-w-full items-center gap-1.5 rounded-full text-left whitespace-nowrap outline-none"
            >
              {email}
              <Copy
                className="size-3.5 shrink-0 opacity-0 group-hover:opacity-100"
                aria-hidden="true"
              />
            </button>
          )}
        </td>
      )}
      <td className={cn(cell, "min-w-40")}>
        {canEditTitle ? (
          <span className="flex items-center gap-2">
            <input
              value={title}
              maxLength={80}
              aria-label={`Title for ${name}`}
              placeholder="Add a title"
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => void titleSave.save(title.trim())}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setTitle(person.title ?? "");
              }}
              className="hover:bg-muted focus:bg-muted rounded-field placeholder:text-muted-foreground/70 -mx-2 h-8 w-full min-w-0 bg-transparent px-2 outline-none"
            />
            <SavedMark status={titleSave.status} error={titleSave.error} />
          </span>
        ) : (
          <span className={person.title ? "" : "text-muted-foreground"}>{person.title ?? ""}</span>
        )}
      </td>
      <td className={cell}>
        {actOnRow ? (
          <span className="flex items-center gap-2">
            <FieldSelect
              value={role}
              aria-label={`Role for ${name}`}
              onChange={(e) => {
                const next = e.target.value as Role;
                setRole(next);
                void roleSave.save(next);
              }}
              className="h-8 w-auto min-w-28 text-[13px]"
            >
              {roleOptions.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </FieldSelect>
            <SavedMark status={roleSave.status} error={roleSave.error} />
          </span>
        ) : (
          <Badge variant={person.role === Role.OWNER ? "accent" : "secondary"}>
            {ROLE_LABELS[person.role]}
          </Badge>
        )}
      </td>
      <td className={cn(cell, "text-muted-foreground whitespace-nowrap")}>
        {shortDate.format(new Date(person.joinedAt))}
      </td>
      {access.canManage && (
        <td className={cn(cell, "pr-0 text-right whitespace-nowrap")}>
          {access.canTransfer && !isSelf && person.role !== Role.OWNER && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title="Make owner"
              aria-label={`Transfer ownership to ${name}`}
              onClick={async () => {
                const ok = await confirm({
                  title: `Make ${name} the owner?`,
                  description: "You become an admin. You can't undo this yourself.",
                  confirmLabel: "Transfer ownership",
                  tone: "destructive",
                  run: async () => (await transferOwnership(orgId, person.id))?.error,
                });
                if (ok) router.refresh();
              }}
            >
              <Crown aria-hidden="true" />
            </Button>
          )}
          {actOnRow && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title="Remove"
              aria-label={`Remove ${name}`}
              className="hover:text-tint-danger-foreground"
              onClick={async () => {
                const ok = await confirm({
                  title: `Remove ${name}?`,
                  description:
                    "They lose access now. Their assignments go; their notes and comments stay.",
                  confirmLabel: "Remove",
                  tone: "destructive",
                  run: async () => (await removeMember(orgId, person.id))?.error,
                });
                if (ok) {
                  toast({ title: "Removed", tone: "success" });
                  router.refresh();
                }
              }}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          )}
        </td>
      )}
    </tr>
  );
}

function InviteLine({
  orgId,
  invite,
  manage,
  showEmailColumn,
}: {
  orgId: string;
  invite: InvitedRow;
  manage: boolean;
  showEmailColumn: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const cell = "border-border/60 border-t py-2.5 pr-3 align-middle";
  const roleLabel = ROLE_LABELS[invite.role as Role] ?? invite.role;

  async function run(action: () => Promise<{ error?: string } | undefined>, done: string) {
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (result?.error) toast({ title: result.error, tone: "error" });
    else {
      toast({ title: done, tone: "success" });
      router.refresh();
    }
  }

  return (
    <tr className="text-muted-foreground">
      {manage && <td className={cn(cell, "w-10")} />}
      <td className={cell}>
        <span className="flex items-center gap-2.5">
          <span className="bg-muted grid size-7 shrink-0 place-items-center rounded-full">
            <Mail className="size-3.5" aria-hidden="true" />
          </span>
          <span className="text-foreground min-w-0 break-all">
            {showEmailColumn ? "" : invite.email}
          </span>
          <Badge variant={invite.expired ? "destructive" : "secondary"}>
            {invite.expired ? "Expired" : "Invited"}
          </Badge>
        </span>
      </td>
      {showEmailColumn && <td className={cn(cell, "break-all")}>{invite.email}</td>}
      <td className={cell} />
      <td className={cell}>{roleLabel}</td>
      <td className={cn(cell, "whitespace-nowrap")}>
        {invite.expired ? "Expired" : "Expires"} {shortDate.format(new Date(invite.expiresAt))}
      </td>
      {manage && (
        <td className={cn(cell, "pr-0 text-right whitespace-nowrap")}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            title="Resend"
            aria-label={`Resend the invite to ${invite.email}`}
            onClick={() => void run(() => resendInvitation(orgId, invite.id), "Resent")}
          >
            {busy ? <Check aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            title="Revoke"
            aria-label={`Revoke the invite to ${invite.email}`}
            className="hover:text-tint-danger-foreground"
            onClick={() => void run(() => revokeInvitation(orgId, invite.id), "Revoked")}
          >
            <X aria-hidden="true" />
          </Button>
        </td>
      )}
    </tr>
  );
}
