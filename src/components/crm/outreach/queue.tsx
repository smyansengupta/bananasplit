"use client";

import { AlarmClock, Check, MessageSquare, NotebookText, Phone } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { closeStepAction, logCallAction, logTouchAction, snoozeAction } from "@/app/app/[orgSlug]/crm/outreach/actions";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { chipClass } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { crmRecordHref } from "@/lib/crm/href";
import { SNOOZES, type SnoozeKey } from "@/lib/crm/outreach/schedule";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

import { ComposeButton, type ComposeTemplate } from "./compose";

/**
 * Who to reach out to today, worked down one person at a time: each row
 * says why they're here and has the one-click ways in: email, text (once a
 * phone provider is connected), call (dials, then logs it), log something,
 * or snooze. A step a sequence left for you is done from here too.
 */

export interface QueueRow {
  key: string;
  targetKind: "person" | "company";
  id: string;
  name: string;
  sub: string | null;
  email: string | null;
  phone: string | null;
  blocked: string | null;
  owner: string | null;
  lastTalked: string | null;
  urgent: boolean;
  reasons: { kind: string; label: string; ref?: string }[];
}

const TONE: Record<string, "destructive" | "accent" | "info" | "secondary" | "success"> = {
  reply: "destructive",
  step: "accent",
  followup: "info",
  new: "success",
  campaign: "accent",
  cadence: "secondary",
  cold: "secondary",
};

export function FollowUpQueue({
  orgId,
  orgSlug,
  rows,
  templates,
  phone,
  title = "Who to reach out to today",
  description,
  empty = "Nobody's waiting on you. Nice.",
}: {
  orgId: string;
  orgSlug: string;
  rows: QueueRow[];
  templates: ComposeTemplate[];
  phone: boolean;
  title?: string;
  description?: string;
  empty?: string;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const shown = rows.filter((r) => !hidden.has(r.key));
  const hide = (key: string) => setHidden((h) => new Set(h).add(key));
  return (
    <section className="bg-card ring-foreground/6 rounded-card space-y-3 p-5 ring-1" aria-label={title}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="heading text-lg">{title}</h2>
        {shown.length > 0 && (
          <span className="bg-foreground/10 text-foreground/70 grid h-[18px] min-w-[18px] place-items-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums">
            {shown.length}
          </span>
        )}
        {description && <p className="text-muted-foreground text-sm">{description}</p>}
      </div>
      {shown.length === 0 ? (
        <EmptyState size="compact" title={empty} />
      ) : (
        <ul className="divide-border divide-y">
          {shown.map((row) => (
            <QueueLine key={row.key} orgId={orgId} orgSlug={orgSlug} row={row} templates={templates} phone={phone} onGone={() => hide(row.key)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function QueueLine({
  orgId,
  orgSlug,
  row,
  templates,
  phone,
  onGone,
}: {
  orgId: string;
  orgSlug: string;
  row: QueueRow;
  templates: ComposeTemplate[];
  phone: boolean;
  onGone: () => void;
}) {
  const router = useRouter();
  const [logging, setLogging] = useState<"call" | "note" | null>(null);
  const reply = row.reasons.find((r) => r.kind === "reply");
  const step = row.reasons.find((r) => r.kind === "step");
  const person = row.targetKind === "person";

  const snooze = async (choice: SnoozeKey) => {
    const r = await runAction(() => snoozeAction(orgId, row.id, choice));
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    onGone();
    toast({ title: `Back ${SNOOZES[choice].label.toLowerCase()}` });
  };

  const done = async () => {
    if (!step?.ref) return;
    const r = await runAction(() => closeStepAction(orgId, step.ref!));
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    toast({ title: "Done" });
    router.refresh();
  };

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
      <div className="min-w-0 flex-1 basis-60">
        <div className="flex items-baseline gap-2">
          <Link href={crmRecordHref(orgSlug, row.targetKind, row.id)} className="truncate font-semibold hover:underline">
            {row.name}
          </Link>
          {row.sub && <span className="text-muted-foreground min-w-0 truncate text-sm">{row.sub}</span>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {row.reasons.map((r) => (
            <Badge key={r.kind} variant={TONE[r.kind] ?? "secondary"}>
              {r.label}
            </Badge>
          ))}
          {row.lastTalked && <span className="text-muted-foreground text-xs">{row.lastTalked}</span>}
          {row.blocked && <span className="text-muted-foreground text-xs">{row.blocked}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {person && (
          <ComposeButton
            orgId={orgId}
            people={[{ id: row.id, name: row.name, email: row.email, blocked: row.blocked }]}
            templates={templates}
            label={reply ? "Reply" : "Email"}
            size="icon-sm"
            variant="ghost"
            replyTo={reply?.ref ? { messageId: reply.ref, subject: reply.label.replace(/^Replied: /, "") } : null}
          />
        )}
        {person &&
          (phone && row.phone && !row.blocked ? (
            <Button asChild variant="ghost" size="icon-sm" title={`Text ${row.phone}`}>
              <a href={`sms:${row.phone}`} aria-label="Text" onClick={() => setLogging("note")}>
                <MessageSquare className="size-4" aria-hidden="true" />
              </a>
            </Button>
          ) : (
            <Button variant="ghost" size="icon-sm" disabled title="Texting needs a phone provider (Integrations and apps)" aria-label="Text">
              <MessageSquare className="size-4" aria-hidden="true" />
            </Button>
          ))}
        {row.phone && !row.blocked ? (
          <Button asChild variant="ghost" size="icon-sm" title={`Call ${row.phone}`}>
            <a href={`tel:${row.phone}`} aria-label="Call" onClick={() => person && setLogging("call")}>
              <Phone className="size-4" aria-hidden="true" />
            </a>
          </Button>
        ) : (
          <Button variant="ghost" size="icon-sm" disabled title="No phone number" aria-label="Call">
            <Phone className="size-4" aria-hidden="true" />
          </Button>
        )}
        {person && (
          <Button variant="ghost" size="icon-sm" title="Log what happened" aria-label="Log" onClick={() => setLogging("note")}>
            <NotebookText className="size-4" aria-hidden="true" />
          </Button>
        )}
        {step && (
          <Button variant="ghost" size="icon-sm" title="Done" aria-label="Mark the step done" onClick={done}>
            <Check className="size-4" aria-hidden="true" />
          </Button>
        )}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" title="Snooze" aria-label="Snooze">
              <AlarmClock className="size-4" aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="flex w-auto gap-1.5 p-2">
            {(Object.keys(SNOOZES) as SnoozeKey[]).map((k) => (
              <button key={k} type="button" className={cn(chipClass(false), "h-8 px-3")} onClick={() => snooze(k)}>
                {SNOOZES[k].label}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </div>
      {logging && person && (
        <LogDialog
          orgId={orgId}
          personId={row.id}
          name={row.name}
          kind={logging}
          stepId={step?.ref ?? null}
          onClose={() => setLogging(null)}
          onDone={() => {
            setLogging(null);
            router.refresh();
          }}
        />
      )}
    </li>
  );
}

const FOLLOW = [
  { days: null, label: "No follow-up" },
  { days: 3, label: "In 3 days" },
  { days: 7, label: "In a week" },
  { days: 30, label: "In a month" },
] as const;

/** Log a call (after the tel: link) or anything else, with the next follow-up in the same step. */
export function LogDialog({
  orgId,
  personId,
  name,
  kind,
  stepId,
  onClose,
  onDone,
}: {
  orgId: string;
  personId: string;
  name: string;
  kind: "call" | "note";
  stepId?: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [outcome, setOutcome] = useState<"talked" | "voicemail" | "no-answer">("talked");
  const [what, setWhat] = useState<"NOTE" | "EMAIL" | "TEXT" | "MEETING">("NOTE");
  const [note, setNote] = useState("");
  const [follow, setFollow] = useState<number | null | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const save = async () => {
    setPending(true);
    const r = await runAction(() =>
      kind === "call"
        ? logCallAction(orgId, { personId, outcome, note, followUpDays: follow, stepId })
        : logTouchAction(orgId, { personId, kind: what, note, followUpDays: follow }),
    );
    setPending(false);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    toast({ title: "Logged", tone: "success" });
    onDone();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{kind === "call" ? `How did the call with ${name} go?` : `Log something with ${name}`}</DialogTitle>
          <DialogDescription>It goes on their timeline and counts as being in touch.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="What happened">
            {kind === "call"
              ? (
                  [
                    ["talked", "Talked"],
                    ["voicemail", "Voicemail"],
                    ["no-answer", "No answer"],
                  ] as const
                ).map(([v, l]) => (
                  <button key={v} type="button" className={cn(chipClass(outcome === v), "h-8 px-3")} onClick={() => setOutcome(v)}>
                    {l}
                  </button>
                ))
              : (
                  [
                    ["NOTE", "Note"],
                    ["EMAIL", "Email"],
                    ["TEXT", "Text"],
                    ["MEETING", "Meeting"],
                  ] as const
                ).map(([v, l]) => (
                  <button key={v} type="button" className={cn(chipClass(what === v), "h-8 px-3")} onClick={() => setWhat(v)}>
                    {l}
                  </button>
                ))}
          </div>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} placeholder={kind === "call" ? "What you talked about (optional)" : "What happened"} />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Follow up">
            {FOLLOW.map((f) => (
              <button
                key={f.label}
                type="button"
                className={cn(chipClass(follow === f.days), "h-8 px-3")}
                onClick={() => setFollow(follow === f.days ? undefined : f.days)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={pending || (kind === "note" && !note.trim())} onClick={save}>
            Log it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
