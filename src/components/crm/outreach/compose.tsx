"use client";

import { Clock, Code, Eye, Mail, Send } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { composeEmailAction, previewAction } from "@/app/app/[orgSlug]/crm/outreach/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { chipClass } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { MERGE_FIELDS } from "@/lib/crm/outreach/merge";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

/**
 * Writing to someone from the CRM (docs/features/crm.md, module 5): pick a
 * template or start blank, merge fields from a menu, see exactly what they
 * will get, then send now or tomorrow morning. It goes from the member's
 * own mailbox once one is connected, the organization's sender until then.
 * If another member is talking to them, it asks first.
 */

export interface ComposePerson {
  id: string;
  name: string;
  email: string | null;
  /** Why they can't be emailed (do not contact, unsubscribed...). */
  blocked?: string | null;
}

export interface ComposeTemplate {
  id: string;
  name: string;
  subject: string | null;
  body: string;
}

export function ComposeButton({
  orgId,
  people,
  templates,
  dealId,
  label = "Email",
  icon = true,
  size = "default",
  variant = "outline",
  replyTo,
  subject: initialSubject,
  body: initialBody,
}: {
  orgId: string;
  people: ComposePerson[];
  templates: ComposeTemplate[];
  dealId?: string;
  label?: string;
  icon?: boolean;
  size?: "default" | "sm" | "icon" | "icon-sm";
  variant?: "outline" | "default" | "ghost" | "secondary";
  replyTo?: { messageId: string; subject: string | null } | null;
  subject?: string;
  body?: string;
}) {
  const [open, setOpen] = useState(false);
  const can = people.some((p) => p.email && !p.blocked);
  const iconOnly = size === "icon" || size === "icon-sm";
  return (
    <>
      <Button
        variant={variant}
        size={size}
        disabled={!can}
        title={can ? label : (people[0]?.blocked ?? "They have no email address.")}
        aria-label={iconOnly ? label : undefined}
        onClick={() => setOpen(true)}
      >
        {icon && <Mail className="size-4" aria-hidden="true" />}
        {!iconOnly && label}
      </Button>
      {open && (
        <ComposeDialog
          orgId={orgId}
          people={people}
          templates={templates}
          dealId={dealId}
          replyTo={replyTo ?? null}
          initialSubject={initialSubject}
          initialBody={initialBody}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

type Stage = { kind: "write" } | { kind: "preview"; subject: string; body: string; missing: string[] } | { kind: "conflict"; text: string };

function tomorrowMorning(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

export function ComposeDialog({
  orgId,
  people,
  templates,
  dealId,
  replyTo,
  initialSubject,
  initialBody,
  onClose,
  onSent,
}: {
  orgId: string;
  people: ComposePerson[];
  templates: ComposeTemplate[];
  dealId?: string;
  replyTo: { messageId: string; subject: string | null } | null;
  initialSubject?: string;
  initialBody?: string;
  onClose: () => void;
  onSent?: () => void;
}) {
  const router = useRouter();
  const reachable = people.filter((p) => p.email && !p.blocked);
  const [to, setTo] = useState(reachable[0]?.id ?? "");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [subject, setSubject] = useState(
    replyTo?.subject ? `Re: ${replyTo.subject.replace(/^re:\s*/i, "")}` : (initialSubject ?? ""),
  );
  const [body, setBody] = useState(replyTo ? "" : (initialBody ?? "Hi {{first_name|there}},\n\n\n\n{{my_first_name}}"));
  const [stage, setStage] = useState<Stage>({ kind: "write" });
  const [pending, setPending] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const person = people.find((p) => p.id === to);

  const pick = (t: ComposeTemplate) => {
    setTemplateId(t.id);
    if (!replyTo) setSubject(t.subject ?? "");
    setBody(t.body);
  };

  const insert = (key: string) => {
    const token = `{{${key}}}`;
    const at = cursor ?? body.length;
    setBody(body.slice(0, at) + token + body.slice(at));
    setCursor(at + token.length);
  };

  const preview = async () => {
    if (!to) return;
    setPending(true);
    const r = await runAction(() => previewAction(orgId, { subject, body }, [to]));
    setPending(false);
    if (!r) return;
    if (!r.ok) {
      toast({ title: r.error, tone: "error" });
      return;
    }
    const row = r.rows[0];
    if (!row) return;
    if (row.blocked) {
      toast({ title: row.blocked, tone: "error" });
      return;
    }
    setStage({ kind: "preview", subject: row.subject, body: row.body, missing: row.missing });
  };

  const send = async (later: boolean, confirmConflict = false) => {
    setPending(true);
    const r = await runAction(() =>
      composeEmailAction(orgId, {
        personId: to,
        subject,
        body,
        templateId,
        dealId: dealId ?? null,
        replyToMessageId: replyTo?.messageId ?? null,
        sendAt: later ? tomorrowMorning() : null,
        confirmConflict,
      }),
    );
    setPending(false);
    if (!r) return;
    if (!r.ok) {
      toast({ title: r.error, tone: "error" });
      return;
    }
    if ("conflict" in r && r.conflict) {
      setStage({ kind: "conflict", text: `${r.conflict.name} ${r.conflict.what}${r.conflict.at ? `, ${relative(r.conflict.at)}` : ""}.` });
      return;
    }
    toast({ title: later ? "It goes tomorrow at 9" : "Sending", tone: "success" });
    onSent?.();
    onClose();
    router.refresh();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{replyTo ? "Reply" : `Email ${person?.name ?? ""}`.trim()}</DialogTitle>
          <DialogDescription>
            {person?.email ? `To ${person.email}. ` : ""}It goes from your organization&apos;s address with your name, and lands on their timeline.
          </DialogDescription>
        </DialogHeader>
        {stage.kind === "conflict" ? (
          <div className="space-y-4">
            <p className="text-[15px]">{stage.text}</p>
            <p className="text-muted-foreground text-sm">Check with them first, or send it anyway.</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStage({ kind: "write" })}>
                Back
              </Button>
              <Button disabled={pending} onClick={() => send(false, true)}>
                <Send className="size-4" aria-hidden="true" />
                Send anyway
              </Button>
            </DialogFooter>
          </div>
        ) : stage.kind === "preview" ? (
          <div className="space-y-4">
            <div className="bg-muted/50 space-y-2 rounded-2xl p-4">
              <p className="text-sm font-semibold">{stage.subject || "(no subject)"}</p>
              <p className="text-[15px] whitespace-pre-wrap">{stage.body}</p>
            </div>
            {stage.missing.length > 0 && (
              <p className="text-sm">
                <Badge variant="accent">Missing</Badge>{" "}
                {stage.missing.map((m) => MERGE_FIELDS.find((f) => f.key === m)?.label ?? m).join(", ")} had nothing for{" "}
                {person?.name}. Add a fallback like {"{{first_name|there}}"}, or edit it.
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setStage({ kind: "write" })}>
                Edit
              </Button>
              <Button variant="outline" disabled={pending} onClick={() => send(true)}>
                <Clock className="size-4" aria-hidden="true" />
                Tomorrow at 9
              </Button>
              <Button disabled={pending} onClick={() => send(false)}>
                <Send className="size-4" aria-hidden="true" />
                Send
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            {reachable.length > 1 && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="To">
                {reachable.map((p) => (
                  <button key={p.id} type="button" className={cn(chipClass(p.id === to), "h-8 px-3")} onClick={() => setTo(p.id)}>
                    {p.name}
                  </button>
                ))}
              </div>
            )}
            {templates.length > 0 && !replyTo && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Templates">
                {templates.slice(0, 8).map((t) => (
                  <button key={t.id} type="button" className={cn(chipClass(t.id === templateId), "h-8 px-3")} onClick={() => pick(t)}>
                    {t.name}
                  </button>
                ))}
              </div>
            )}
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">Subject</span>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} />
            </label>
            <div className="grid gap-1.5 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground flex-1">Message</span>
                <MergeMenu onPick={insert} />
              </div>
              <Textarea
                value={body}
                rows={9}
                onChange={(e) => setBody(e.target.value)}
                onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={pending || !to || !subject.trim() || !body.trim()} onClick={preview}>
                <Eye className="size-4" aria-hidden="true" />
                Preview
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Insert a merge field: grouped by where it comes from. */
export function MergeMenu({ onPick }: { onPick: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const groups = ["Person", "Company", "History", "You"] as const;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          <Code className="size-4" aria-hidden="true" />
          Add a field
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-72 gap-3 p-3">
        {groups.map((g) => (
          <div key={g} className="grid gap-1">
            <span className="text-muted-foreground text-xs font-medium">{g}</span>
            <div className="flex flex-wrap gap-1">
              {MERGE_FIELDS.filter((f) => f.group === g).map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className="bg-muted hover:bg-muted-strong rounded-full px-2.5 py-1 text-xs"
                  title={`{{${f.key}}}, e.g. ${f.example}`}
                  onClick={() => {
                    onPick(f.key);
                    setOpen(false);
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function relative(iso: string): string {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}
