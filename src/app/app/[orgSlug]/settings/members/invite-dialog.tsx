"use client";

import { Check, Copy, Loader2, UserPlus, X } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { Role } from "@/generated/prisma/enums";

import { inviteMembers, type BulkInviteResult } from "./actions";
import { MAX_BULK_INVITES } from "./invite-limits";

const ROLE_OPTIONS = [
  { value: Role.MEMBER, label: "Member" },
  { value: Role.TREASURER, label: "Treasurer" },
  { value: Role.ADMIN, label: "Admin" },
];

/** The addresses in a paste, the way the server splits them. */
function countEmails(text: string): number {
  return new Set(
    text
      .split(/[\s,;]+/)
      .map((e) => e.trim())
      .filter(Boolean),
  ).size;
}

export interface InviteLink {
  code: string;
  url: string;
  enabled: boolean;
}

/**
 * The one way to invite, opened from every Invite button (People, the
 * Members page, the org chart): paste any number of emails, pick one role,
 * Send. Each address that couldn't be invited stays in the box with the
 * reason beside it; the rest are sent. The join link and code sit under
 * it, a click to copy, for inviting without emails.
 */
export function InviteDialog({
  orgId,
  orgSlug,
  link,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
  orgId: string;
  orgSlug: string;
  link: InviteLink | null;
  /** The button that opens it; omitted when the caller controls `open`. */
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = (next: boolean) => {
    setOwnOpen(next);
    onOpenChange?.(next);
  };
  const [text, setText] = useState("");
  const [role, setRole] = useState<Role>(Role.MEMBER);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<BulkInviteResult["results"]>([]);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const count = countEmails(text);

  async function send() {
    if (count === 0) return;
    setBusy(true);
    setError(null);
    const result = await inviteMembers(orgId, { emails: text, role });
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    const failed = result.results.filter((r) => r.error);
    const sent = result.results.length - failed.length;
    setProblems(failed);
    // What couldn't be sent stays in the box to fix; the rest are done.
    setText(failed.map((r) => r.email).join("\n"));
    if (sent > 0) {
      toast({ title: `${sent} ${sent === 1 ? "invite" : "invites"} sent`, tone: "success" });
      router.refresh();
    }
    if (failed.length === 0) setOpen(false);
  }

  async function copy(what: "code" | "link", value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      toast({ title: "Couldn't copy. Select it and copy instead.", tone: "error" });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          setProblems([]);
        }
      }}
    >
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite people</DialogTitle>
          <DialogDescription>Links last 7 days.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-emails">Emails</Label>
            <Textarea
              id="invite-emails"
              value={text}
              autoFocus
              rows={4}
              spellCheck={false}
              autoComplete="off"
              placeholder="maya@school.edu, sam@school.edu"
              onChange={(e) => {
                setText(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            {problems.length > 0 && (
              <ul className="flex flex-col gap-1 text-[13px]" aria-live="polite">
                {problems.map((p) => (
                  <li key={p.email} className="flex flex-wrap gap-x-2">
                    <span className="font-medium break-all">{p.email}</span>
                    <span className="text-tint-danger-foreground">{p.error}</span>
                  </li>
                ))}
              </ul>
            )}
            {error && (
              <p role="alert" className="text-tint-danger-foreground text-[13px]">
                {error}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <span id="invite-role-label" className="text-sm font-medium">
              Role
            </span>
            <Segmented
              label="Role"
              value={role}
              onSelect={(v) => setRole(v as Role)}
              options={ROLE_OPTIONS}
              className="self-start"
            />
          </div>
          <div className="flex items-center justify-end gap-3">
            {count > MAX_BULK_INVITES && (
              <span className="text-tint-danger-foreground mr-auto text-[13px]">
                Up to {MAX_BULK_INVITES} at a time.
              </span>
            )}
            <Button type="submit" disabled={busy || count === 0 || count > MAX_BULK_INVITES}>
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <UserPlus aria-hidden="true" />
              )}
              {count > 1 ? `Send ${count} invites` : "Send invite"}
            </Button>
          </div>
        </form>

        <div className="border-border/70 flex flex-col gap-2 border-t pt-4">
          <span className="text-sm font-medium">Or share the link</span>
          {link && link.enabled ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void copy("code", link.code)}
                aria-label={`Copy the code ${link.code}`}
                className="bg-muted hover:bg-muted/70 focus-glow rounded-field inline-flex h-10 items-center gap-2 px-3.5 font-mono text-[15px] font-semibold tracking-wider outline-none"
              >
                {link.code}
                {copied === "code" ? (
                  <Check className="text-success size-4" aria-hidden="true" />
                ) : (
                  <Copy className="text-muted-foreground size-4" aria-hidden="true" />
                )}
              </button>
              <Button type="button" variant="outline" onClick={() => void copy("link", link.url)}>
                {copied === "link" ? (
                  <Check className="text-success" aria-hidden="true" />
                ) : (
                  <Copy aria-hidden="true" />
                )}
                {copied === "link" ? "Copied" : "Copy link"}
              </Button>
              <Link
                href={`/app/${orgSlug}/settings/members#code`}
                className="text-muted-foreground ml-auto text-[13px] underline underline-offset-4"
                onClick={() => setOpen(false)}
              >
                Settings
              </Link>
            </div>
          ) : (
            <p className="text-muted-foreground flex items-center gap-2 text-[13px]">
              <X className="size-3.5" aria-hidden="true" />
              The invite code is off.{" "}
              <Link
                href={`/app/${orgSlug}/settings/members#code`}
                className="text-foreground underline underline-offset-4"
                onClick={() => setOpen(false)}
              >
                Turn it on
              </Link>
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
