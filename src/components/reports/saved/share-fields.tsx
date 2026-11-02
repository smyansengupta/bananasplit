"use client";

import { useEffect, useState, useTransition } from "react";

import {
  addReportInvitesAction,
  getReportSharingAction,
  removeReportInviteAction,
  setReportLinkAction,
  updateReportAction,
  type SharingState,
} from "@/app/app/[orgSlug]/databases/reports/report-actions";
import { Copy, Globe, Lock, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toaster";
import { readInviteEmails, SHARE_NOTE } from "@/lib/reports/share";

export type ReportAccessChoice = "ORGANIZATION" | "PRIVATE";

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast({ title: "Copied" });
  } catch {
    toast({ title: "Couldn't copy. Select the link and copy it." });
  }
}

/** Only me or Organization, and what that means. */
export function AccessPicker({
  value,
  onSelect,
  disabled,
}: {
  value: ReportAccessChoice;
  onSelect?: (value: ReportAccessChoice) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-2">
      <span className="text-sm font-semibold">Who can see it</span>
      <Segmented
        label="Who can see it"
        value={value}
        onSelect={disabled ? undefined : (v) => onSelect?.(v as ReportAccessChoice)}
        options={[
          { value: "PRIVATE", label: "Only me", icon: Lock },
          { value: "ORGANIZATION", label: "Organization", icon: Globe },
        ]}
        className="w-fit"
      />
      <span className="text-muted-foreground text-[13px]">
        {value === "PRIVATE"
          ? "Only you can open it."
          : "Everyone in the organization can open it, and sees only the rows they can open themselves."}
      </span>
    </div>
  );
}

/** A link shown to copy, read-only. */
export function CopyField({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <Input
        readOnly
        value={value}
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
        className="min-w-0 flex-1 text-[13px]"
      />
      <Button type="button" variant="outline" onClick={() => copy(value)}>
        <Copy className="size-4" aria-hidden="true" />
        Copy
      </Button>
    </div>
  );
}

/**
 * Outside the organization: the view-only link and the people invited by
 * email. The same fields for a new report (nothing saved yet) and a saved
 * one (each change saves).
 */
export function OutsideSharing({
  link,
  url,
  onLink,
  onNewLink,
  invites,
  onAdd,
  onRemove,
  inviteUrl,
  pending,
}: {
  link: boolean;
  /** The link to copy, when it was just made (it's shown once). */
  url: string | null;
  onLink: (on: boolean) => void;
  /** A saved report's "New link"; a new report gets its link when it's saved. */
  onNewLink?: () => void;
  invites: readonly string[];
  /** Adds what was typed; an error to show, or nothing. */
  onAdd: (typed: string) => Promise<string | null> | string | null;
  onRemove: (email: string) => void;
  /** Where invited people open it, to send them. */
  inviteUrl?: string;
  pending?: boolean;
}) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!typed.trim()) return;
    const problem = await onAdd(typed);
    setError(problem);
    if (!problem) setTyped("");
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <span className="text-sm font-semibold">Outside the organization</span>
        <span className="text-muted-foreground text-[13px]">{SHARE_NOTE}</span>
      </div>

      <div className="grid gap-2.5">
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={link} disabled={pending} onCheckedChange={onLink} />
          <span>Anyone with the link can view it</span>
        </label>
        {link &&
          (url ? (
            <CopyField value={url} label="View-only link" />
          ) : onNewLink ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-muted-foreground text-[13px]">
                The link shows only when it&apos;s made. A new one stops the old one.
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={onNewLink}
              >
                New link
              </Button>
            </div>
          ) : (
            <span className="text-muted-foreground text-[13px]">
              You get the link when you save.
            </span>
          ))}
      </div>

      <div className="grid gap-2.5">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Input
            type="text"
            inputMode="email"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Invite by email"
            aria-label="Invite by email"
            className="min-w-0 flex-1"
          />
          <Button type="submit" variant="outline" disabled={pending || !typed.trim()}>
            Invite
          </Button>
        </form>
        {error && (
          <p role="alert" className="text-tint-danger-foreground text-[13px]">
            {error}
          </p>
        )}
        {invites.length > 0 && (
          <>
            <ul className="divide-border grid divide-y text-sm">
              {invites.map((email) => (
                <li key={email} className="flex items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate">{email}</span>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Stop sharing with ${email}`}
                    title="Remove"
                    disabled={pending}
                    onClick={() => onRemove(email)}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
            <span className="text-muted-foreground text-[13px]">
              They sign in with that email to open it.
            </span>
            {inviteUrl && <CopyField value={inviteUrl} label="Link for invited people" />}
          </>
        )}
      </div>
    </div>
  );
}

/** A new report's sharing, kept in the Save dialog until it's saved. */
export function useDraftSharing() {
  const [link, setLink] = useState(false);
  const [invites, setInvites] = useState<string[]>([]);
  const fields = {
    link,
    url: null,
    onLink: setLink,
    invites,
    onAdd: (typed: string) => {
      const { emails, bad } = readInviteEmails(typed);
      if (bad.length > 0) return `${bad[0]} isn't an email address.`;
      if (emails.length === 0) return "Type an email address.";
      setInvites((list) => [...list, ...emails.filter((e) => !list.includes(e))]);
      return null;
    },
    onRemove: (email: string) => setInvites((list) => list.filter((e) => e !== email)),
  };
  return { link, invites, fields };
}

/**
 * A saved report's Share dialog (its ••• menu): who in the organization
 * sees it, and who outside it does. Every change saves as it's made.
 */
export function ShareDialog({
  orgId,
  reportId,
  access,
  isOwner,
  open,
  onOpenChange,
}: {
  orgId: string;
  reportId: string;
  access: ReportAccessChoice;
  isOwner: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, setState] = useState<SharingState | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    let live = true;
    getReportSharingAction(orgId, reportId).then((result) => {
      if (!live) return;
      if (result.ok) setState(result.sharing);
      else setError(result.error);
    });
    return () => {
      live = false;
    };
  }, [open, orgId, reportId]);

  function link(on: boolean) {
    start(async () => {
      const result = await setReportLinkAction(orgId, reportId, on);
      if (!result.ok) {
        toast({ title: result.error });
        return;
      }
      setUrl(result.link);
      setState((s) => (s ? { ...s, link: on } : s));
    });
  }

  function choose(next: ReportAccessChoice) {
    if (next === access) return;
    start(async () => {
      const result = await updateReportAction(orgId, reportId, { access: next });
      if (!result.ok) {
        toast({ title: result.error });
        return;
      }
      // Only me closes it outside the organization too.
      if (next === "PRIVATE") {
        setUrl(null);
        setState((s) => (s ? { ...s, link: false, invites: [] } : s));
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setUrl(null);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share report</DialogTitle>
          <DialogDescription className="sr-only">Who can see this report.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6">
          <AccessPicker value={access} onSelect={choose} disabled={!isOwner || pending} />
          {!isOwner && (
            <p className="text-muted-foreground -mt-4 text-[13px]">
              Only whoever made it changes who in the organization sees it.
            </p>
          )}
          {access === "PRIVATE" ? (
            <p className="text-muted-foreground text-[13px]">
              Pick Organization to share it outside the organization too.
            </p>
          ) : state ? (
            <OutsideSharing
              link={state.link}
              url={url}
              onLink={link}
              onNewLink={() => link(true)}
              invites={state.invites}
              inviteUrl={state.inviteUrl}
              pending={pending}
              onAdd={async (typed) => {
                const result = await addReportInvitesAction(orgId, reportId, typed);
                if (!result.ok) return result.error;
                setState((s) => (s ? { ...s, invites: result.invites } : s));
                return null;
              }}
              onRemove={(email) =>
                start(async () => {
                  const result = await removeReportInviteAction(orgId, reportId, email);
                  if (!result.ok) {
                    toast({ title: result.error });
                    return;
                  }
                  setState((s) =>
                    s ? { ...s, invites: s.invites.filter((e) => e !== email) } : s,
                  );
                })
              }
            />
          ) : (
            <p className="text-muted-foreground text-[13px]">{error ?? "Loading…"}</p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
