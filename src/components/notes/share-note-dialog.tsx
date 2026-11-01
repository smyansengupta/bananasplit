"use client";

import {
  Check,
  ChevronsUpDown,
  Link2,
  Loader2,
  Lock,
  UserPlus,
  Users,
  X,
} from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  removeNoteShare,
  shareNote,
  updateNoteAccess,
  updateNoteShare,
} from "@/app/app/[orgSlug]/notes/actions";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/toaster";
import { Segmented, segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { UserAvatar } from "@/components/user-avatar";
import type { NoteGeneralAccess } from "@/lib/notes/access";
import { cn } from "@/lib/utils";
import type { NoteShareRow } from "@/server/notes/sharing";

type ShareRole = NoteShareRow["role"];

interface Person {
  id: string;
  name: string | null;
  image: string | null;
  avatar?: unknown;
}

/** What the note page knows about who has access, for the Share button. */
export interface NoteSharingInfo {
  /** The author, or an owner/admin on a club note. */
  canShare: boolean;
  isAuthor: boolean;
  viewerId: string;
  /** The viewer's own share of the note, if it was shared with them. */
  myRole: ShareRole | null;
  author: Person;
  generalAccess: NoteGeneralAccess;
  shares: NoteShareRow[];
  /** Everyone in the club, for the people picker. */
  members: Person[];
}

const ROLE_LABELS: Record<ShareRole, string> = { VIEWER: "Viewer", EDITOR: "Editor" };

/** What everyone else in the club gets, as three buttons. */
const ACCESS_OPTIONS: { value: NoteGeneralAccess; label: string }[] = [
  { value: "RESTRICTED", label: "Only added" },
  { value: "CLUB_VIEW", label: "Org can view" },
  { value: "CLUB_EDIT", label: "Org can edit" },
];

/** "Only you", "Shared with 3", "Club can view", "Club can edit". */
function accessSummary(access: NoteGeneralAccess, shareCount: number, isAuthor: boolean): string {
  if (access === "CLUB_EDIT") return "Org can edit";
  if (access === "CLUB_VIEW") return shareCount > 0 ? `Org + ${shareCount}` : "Org can view";
  if (shareCount === 0) return isAuthor ? "Only you" : "Private";
  return `Shared with ${shareCount}`;
}

/**
 * The note's Share button and dialog, like a shared document's: add club
 * members as viewers or editors, change or remove them, and set what
 * everyone else in the club gets (nothing, read, or edit). Every choice is a
 * button, and each change saves at once (src/app/app/[orgSlug]/notes/
 * actions.ts, sharing section), so there's no Done; people who can't share
 * see who has access, and can take themselves off.
 */
export function ShareNoteDialog({
  orgId,
  orgSlug,
  noteId,
  title,
  sharing,
}: {
  orgId: string;
  orgSlug: string;
  noteId: string;
  title: string;
  sharing: NoteSharingInfo;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState(sharing.shares);
  const [access, setAccess] = useState(sharing.generalAccess);
  const [picked, setPicked] = useState<string[]>([]);
  const [role, setRole] = useState<ShareRole>("EDITOR");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { canShare } = sharing;

  const sharedIds = new Set(shares.map((s) => s.userId));
  const candidates = sharing.members.filter(
    (m) => m.id !== sharing.author.id && !sharedIds.has(m.id),
  );
  const pickedPeople = sharing.members.filter((m) => picked.includes(m.id));

  function run(fn: () => Promise<{ error?: string; shares?: NoteShareRow[] }>, done?: () => void) {
    setError(null);
    start(async () => {
      const result = await fn();
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.shares) setShares(result.shares);
      done?.();
    });
  }

  function addPeople() {
    if (picked.length === 0) return;
    const count = picked.length;
    run(
      () => shareNote(orgId, noteId, { userIds: picked, role }),
      () => {
        setPicked([]);
        toast({
          title: count === 1 ? "Shared" : `Shared with ${count}`,
          tone: "success",
          duration: 3_000,
        });
      },
    );
  }

  function changeAccess(next: NoteGeneralAccess) {
    const previous = access;
    setAccess(next);
    setError(null);
    start(async () => {
      const result = await updateNoteAccess(orgId, noteId, next);
      if (result.error) {
        setAccess(previous);
        setError(result.error);
      }
    });
  }

  function removeMe() {
    run(
      () => removeNoteShare(orgId, noteId, sharing.viewerId),
      () => {
        setOpen(false);
        toast({ title: "Removed", tone: "success", duration: 3_000 });
        if (access === "RESTRICTED") router.push(`/app/${orgSlug}/notes`);
        else router.refresh();
      },
    );
  }

  function copyLink() {
    void navigator.clipboard
      ?.writeText(`${window.location.origin}/app/${orgSlug}/notes/${noteId}`)
      .then(() => toast({ title: "Copied", tone: "success", duration: 3_000 }))
      .catch(() => toast({ title: "Couldn't copy the link", tone: "error" }));
  }

  const summary = accessSummary(access, shares.length, sharing.isAuthor);
  const SummaryIcon = access === "RESTRICTED" ? (shares.length > 0 ? Users : Lock) : Users;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <SummaryIcon aria-hidden="true" />
          {canShare ? "Share" : summary}
          {canShare && (
            <span className="text-muted-foreground hidden font-normal sm:inline">{summary}</span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="break-words">
            Share “{title.trim() || "Untitled note"}”
          </DialogTitle>
          <DialogDescription className={cn(canShare && "sr-only")}>
            {canShare
              ? "Add people and choose what the organization gets."
              : sharing.myRole === "EDITOR" || access === "CLUB_EDIT"
                ? "You can edit. The author controls access."
                : "You can view. The author controls access."}
          </DialogDescription>
        </DialogHeader>

        {canShare && (
          <div className="flex flex-wrap items-start gap-2">
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={pickerOpen}
                  aria-label="Add people"
                  className="h-auto min-h-8 min-w-0 flex-1 justify-between py-1 font-normal"
                >
                  <span className="flex min-w-0 flex-wrap items-center gap-1">
                    {pickedPeople.length === 0 ? (
                      <span className="text-muted-foreground">Add people…</span>
                    ) : (
                      pickedPeople.map((p) => (
                        <span
                          key={p.id}
                          className="bg-muted inline-flex items-center gap-1 rounded-full py-0.5 ps-0.5 pe-2 text-xs"
                        >
                          <UserAvatar user={p} size="xs" />
                          {p.name ?? "Member"}
                        </span>
                      ))
                    )}
                  </span>
                  <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search members…" />
                  <CommandList>
                    <CommandEmpty>
                      {candidates.length === 0
                        ? "Everyone in the organization has access already."
                        : "No members found."}
                    </CommandEmpty>
                    <CommandGroup>
                      {candidates.map((m) => (
                        <CommandItem
                          key={m.id}
                          value={`${m.name ?? "Member"} ${m.id}`}
                          onSelect={() =>
                            setPicked((ids) =>
                              ids.includes(m.id) ? ids.filter((id) => id !== m.id) : [...ids, m.id],
                            )
                          }
                        >
                          <Check
                            className={cn(
                              "size-4",
                              picked.includes(m.id) ? "opacity-100" : "opacity-0",
                            )}
                            aria-hidden="true"
                          />
                          <UserAvatar user={m} size="xs" />
                          {m.name ?? "Member"}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <Segmented
              label="Their access"
              options={[
                { value: "EDITOR", label: "Editor" },
                { value: "VIEWER", label: "Viewer" },
              ]}
              value={role}
              onSelect={(v) => setRole(v as ShareRole)}
            />
            <Button
              type="button"
              size="sm"
              disabled={pending || picked.length === 0}
              onClick={addPeople}
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <UserPlus aria-hidden="true" />
              )}
              Share
            </Button>
          </div>
        )}

        <div className="space-y-1">
          <p className="text-muted-foreground text-xs font-medium">People with access</p>
          <ul className="max-h-64 divide-y overflow-y-auto rounded-lg border">
            <PersonRow
              person={sharing.author}
              you={sharing.author.id === sharing.viewerId}
              right={<span className="text-muted-foreground text-xs">Author</span>}
            />
            {shares.map((s) => {
              const you = s.userId === sharing.viewerId;
              return (
                <PersonRow
                  key={s.userId}
                  person={s.user}
                  you={you}
                  right={
                    canShare ? (
                      <span className="flex items-center gap-1">
                        {/* One click flips Editor and Viewer. */}
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          disabled={pending}
                          aria-label={`${s.user.name ?? "Member"} is ${ROLE_LABELS[s.role].toLowerCase()}; make ${s.role === "EDITOR" ? "viewer" : "editor"}`}
                          title={s.role === "EDITOR" ? "Make viewer" : "Make editor"}
                          onClick={() =>
                            run(() =>
                              updateNoteShare(
                                orgId,
                                noteId,
                                s.userId,
                                s.role === "EDITOR" ? "VIEWER" : "EDITOR",
                              ),
                            )
                          }
                        >
                          {ROLE_LABELS[s.role]}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove ${s.user.name ?? "this member"}`}
                          title="Remove"
                          disabled={pending}
                          onClick={() => run(() => removeNoteShare(orgId, noteId, s.userId))}
                        >
                          <X className="size-4" aria-hidden="true" />
                        </Button>
                      </span>
                    ) : you ? (
                      <span className="flex items-center gap-2">
                        <span className="text-muted-foreground text-xs">{ROLE_LABELS[s.role]}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          disabled={pending}
                          onClick={removeMe}
                        >
                          Remove me
                        </Button>
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">{ROLE_LABELS[s.role]}</span>
                    )
                  }
                />
              );
            })}
          </ul>
        </div>

        <div className="space-y-1.5">
          <p id="note-general-access" className="text-muted-foreground text-xs font-medium">
            Everyone else in the organization
          </p>
          <div
            role="radiogroup"
            aria-labelledby="note-general-access"
            className={cn(segmentedTrack, "flex w-full")}
          >
            {ACCESS_OPTIONS.map((o) => {
              // Only the author makes a club note private (an admin would lose it).
              const locked =
                !canShare ||
                pending ||
                (o.value === "RESTRICTED" && !sharing.isAuthor && access !== "RESTRICTED");
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={access === o.value}
                  disabled={locked}
                  onClick={() => access !== o.value && changeAccess(o.value)}
                  className={cn(
                    segmentedItem(access === o.value),
                    "flex-1 justify-center disabled:cursor-not-allowed disabled:opacity-60",
                  )}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}

        <DialogFooter className="gap-2 sm:justify-start">
          <Button type="button" variant="outline" onClick={copyLink}>
            <Link2 aria-hidden="true" />
            Copy link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PersonRow({
  person,
  you,
  right,
}: {
  person: Person;
  you: boolean;
  right: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-2.5 px-3 py-2">
      <UserAvatar user={person} size="sm" />
      <span className="min-w-0 flex-1 text-sm break-words">
        {person.name ?? "Member"}
        {you && <span className="text-muted-foreground"> (you)</span>}
      </span>
      {right}
    </li>
  );
}
