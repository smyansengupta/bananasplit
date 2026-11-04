"use client";

import { ArrowRight, Mail, MessageSquare, NotebookText, Phone, Plus, Repeat, Trash2, UserPlus, Users } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  archiveSequenceAction,
  createSequenceAction,
  enrollAction,
  saveSequenceAction,
  setSequenceStatusAction,
  stopEnrollmentAction,
} from "@/app/app/[orgSlug]/crm/outreach/actions";
import { CrmPicker } from "@/components/crm/crm-picker";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { chipClass } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import type { CrmStepKind } from "@/generated/prisma/enums";
import { windowLabel, type SendWindow } from "@/lib/crm/outreach/schedule";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

import { MergeMenu } from "./compose";

/**
 * Sequences: timed steps that stop when they reply, book, unsubscribe or
 * bounce. Email steps go from the enrolling member's mailbox inside the
 * send window; calls, LinkedIn notes and to-dos land in their queue.
 */

export interface SequenceRow {
  id: string;
  name: string;
  status: "DRAFT" | "ON" | "OFF";
  steps: number;
  active: number;
  replied: number;
  finished: number;
}

export function SequencesList({ orgId, orgSlug, sequences }: { orgId: string; orgSlug: string; sequences: SequenceRow[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const create = async () => {
    const r = await runAction(() => createSequenceAction(orgId, name));
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    router.push(`/app/${orgSlug}/crm/outreach/sequences/${r.id}`);
  };
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="create" onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden="true" />
          New sequence
        </Button>
      </div>
      {sequences.length === 0 ? (
        <EmptyState icon={Repeat} title="No sequences yet" description="A first email, a nudge three days later, a call a week on. It stops the moment they reply." />
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
          {sequences.map((s) => {
            const started = s.active + s.replied + s.finished;
            return (
              <li key={s.id}>
                <Link
                  href={`/app/${orgSlug}/crm/outreach/sequences/${s.id}`}
                  className="bg-card ring-foreground/6 rounded-card hover:ring-foreground/15 flex flex-col gap-2 p-4 ring-1"
                >
                  <div className="flex items-center gap-2">
                    <p className="heading min-w-0 flex-1 truncate text-[15px]">{s.name}</p>
                    <Badge variant={s.status === "ON" ? "success" : "secondary"}>{s.status === "ON" ? "On" : s.status === "OFF" ? "Off" : "Draft"}</Badge>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    {s.steps} {s.steps === 1 ? "step" : "steps"}, {s.active} in it now
                    {started ? `, ${Math.round((s.replied / started) * 100)}% replied` : ""}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New sequence</DialogTitle>
            <DialogDescription>It starts with two emails three days apart. Change anything after.</DialogDescription>
          </DialogHeader>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) {
                e.preventDefault();
                void create();
              }
            }}
            placeholder="Alumni catch-up"
            autoFocus
            maxLength={120}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button disabled={!name.trim()} onClick={create}>
              Make it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export interface StepState {
  kind: CrmStepKind;
  delayDays: number;
  delayHours: number;
  subject: string;
  body: string;
  templateId: string | null;
  taskTitle: string;
}

export interface EnrollmentRow {
  id: string;
  personId: string;
  name: string;
  status: string;
  step: number;
  next: string | null;
  sender: string;
  reason: string | null;
}

const KIND_LOOK: Record<CrmStepKind, { label: string; icon: typeof Mail }> = {
  EMAIL: { label: "Email", icon: Mail },
  CALL: { label: "Call", icon: Phone },
  LINKEDIN: { label: "LinkedIn", icon: UserPlus },
  TEXT: { label: "Text", icon: MessageSquare },
  TASK: { label: "To-do", icon: NotebookText },
};

const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const STATUS_WORDS: Record<string, string> = {
  ACTIVE: "In it",
  PAUSED: "Paused",
  REPLIED: "Replied",
  BOOKED: "Booked",
  FINISHED: "Finished",
  STOPPED: "Stopped",
  BOUNCED: "Bounced",
  UNSUBSCRIBED: "Unsubscribed",
};

export function SequenceEditor({
  orgId,
  orgSlug,
  sequence,
  templates,
  enrollments,
  tz,
}: {
  orgId: string;
  orgSlug: string;
  sequence: { id: string; name: string; status: "DRAFT" | "ON" | "OFF"; stopOnReply: boolean; stopOnBooking: boolean; window: SendWindow; steps: StepState[] };
  templates: { id: string; name: string }[];
  enrollments: EnrollmentRow[];
  tz: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(sequence.name);
  const [steps, setSteps] = useState<StepState[]>(sequence.steps);
  const [win, setWin] = useState<SendWindow>(sequence.window);
  const [stopOnReply, setStopOnReply] = useState(sequence.stopOnReply);
  const [stopOnBooking, setStopOnBooking] = useState(sequence.stopOnBooking);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [adding, setAdding] = useState(false);
  const change = (i: number, patch: Partial<StepState>) => {
    setSteps((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    setDirty(true);
  };

  const save = async () => {
    setPending(true);
    const r = await runAction(() =>
      saveSequenceAction(orgId, sequence.id, { name, stopOnReply, stopOnBooking, sendWindow: win, steps }),
    );
    setPending(false);
    if (!r) return false;
    if (!r.ok) {
      toast({ title: r.error, tone: "error" });
      return false;
    }
    setDirty(false);
    toast({ title: "Saved", tone: "success" });
    router.refresh();
    return true;
  };

  const toggle = async () => {
    if (dirty && !(await save())) return;
    const r = await runAction(() => setSequenceStatusAction(orgId, sequence.id, sequence.status === "ON" ? "OFF" : "ON"));
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    toast({ title: sequence.status === "ON" ? "Off: nothing more goes out" : "On" });
    router.refresh();
  };

  const archive = async () => {
    const r = await runAction(() => archiveSequenceAction(orgId, sequence.id));
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    router.push(`/app/${orgSlug}/crm/outreach/sequences`);
  };

  const stop = async (id: string) => {
    const r = await runAction(() => stopEnrollmentAction(orgId, id));
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    router.refresh();
  };

  const elapsedAt = steps.map((_, i) => steps.slice(0, i + 1).reduce((n, x) => n + x.delayDays, 0));
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
            className="max-w-sm"
            aria-label="Name"
          />
          <Badge variant={sequence.status === "ON" ? "success" : "secondary"}>{sequence.status === "ON" ? "On" : "Off"}</Badge>
          <div className="ms-auto flex gap-2">
            <Button variant="outline" onClick={toggle}>
              {sequence.status === "ON" ? "Turn off" : "Turn on"}
            </Button>
            <Button disabled={!dirty || pending} onClick={save}>
              Save
            </Button>
          </div>
        </div>
        <ol className="space-y-3">
          {steps.map((s, i) => {
            const Look = KIND_LOOK[s.kind];
            return (
              <li key={i} className="bg-card ring-foreground/6 rounded-card space-y-3 p-4 ring-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="bg-muted grid size-7 place-items-center rounded-full text-xs font-semibold">{i + 1}</span>
                  <div className="flex flex-wrap gap-1" role="group" aria-label="What this step does">
                    {(Object.keys(KIND_LOOK) as CrmStepKind[]).map((k) => {
                      const L = KIND_LOOK[k];
                      return (
                        <button key={k} type="button" className={cn(chipClass(s.kind === k), "h-8 px-3")} onClick={() => change(i, { kind: k })}>
                          <L.icon className="size-3.5" aria-hidden="true" />
                          {L.label}
                        </button>
                      );
                    })}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="ms-auto"
                    aria-label={`Remove step ${i + 1}`}
                    disabled={steps.length === 1}
                    onClick={() => {
                      setSteps((x) => x.filter((_, j) => j !== i));
                      setDirty(true);
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{i === 0 ? "Wait" : "Then wait"}</span>
                  <Input
                    type="number"
                    min={0}
                    max={365}
                    value={s.delayDays}
                    onChange={(e) => change(i, { delayDays: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })}
                    className="h-8 w-20"
                    aria-label="Days to wait"
                  />
                  <span className="text-muted-foreground">days{i === 0 ? " after they're added" : ""}, day {elapsedAt[i]}</span>
                </div>
                {s.kind === "EMAIL" ? (
                  <div className="space-y-2">
                    {templates.length > 0 && (
                      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Template">
                        <button type="button" className={cn(chipClass(!s.templateId), "h-8 px-3")} onClick={() => change(i, { templateId: null })}>
                          Write it here
                        </button>
                        {templates.slice(0, 6).map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            className={cn(chipClass(s.templateId === t.id), "h-8 px-3")}
                            onClick={() => change(i, { templateId: t.id, body: "" })}
                          >
                            {t.name}
                          </button>
                        ))}
                      </div>
                    )}
                    <Input
                      value={s.subject}
                      onChange={(e) => change(i, { subject: e.target.value })}
                      placeholder={i === 0 ? "Subject" : "Subject (blank answers the first email)"}
                      aria-label="Subject"
                    />
                    {!s.templateId && (
                      <>
                        <div className="flex justify-end">
                          <MergeMenu onPick={(k) => change(i, { body: `${s.body}{{${k}}}` })} />
                        </div>
                        <Textarea value={s.body} rows={5} onChange={(e) => change(i, { body: e.target.value })} aria-label="Message" />
                      </>
                    )}
                  </div>
                ) : s.kind === "TEXT" ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground flex-1 text-xs">
                        Sent from your organization&apos;s number to people who agreed to texts. Anyone else lands in your queue to text by hand.
                      </span>
                      <MergeMenu onPick={(k) => change(i, { body: `${s.body}{{${k}}}` })} />
                    </div>
                    <Textarea
                      value={s.body}
                      rows={3}
                      maxLength={1000}
                      onChange={(e) => change(i, { body: e.target.value })}
                      placeholder="Hi {{first_name|there}}, it's {{my_first_name}}. Still up for coffee this week?"
                      aria-label="The text"
                    />
                  </div>
                ) : (
                  <Input
                    value={s.taskTitle}
                    onChange={(e) => change(i, { taskTitle: e.target.value })}
                    placeholder={
                      Look.label === "Call"
                        ? "Call {{first_name}}"
                        : Look.label === "LinkedIn"
                          ? "Connect on LinkedIn"
                          : "What to do (a task for you, due that day)"
                    }
                    aria-label="What to do"
                  />
                )}
              </li>
            );
          })}
        </ol>
        <Button
          variant="outline"
          disabled={steps.length >= 20}
          onClick={() => {
            setSteps((s) => [...s, { kind: "EMAIL", delayDays: 3, delayHours: 0, subject: "", body: "Hi {{first_name|there}},\n\n\n\n{{my_first_name}}", templateId: null, taskTitle: "" }]);
            setDirty(true);
          }}
        >
          <Plus className="size-4" aria-hidden="true" />
          Add a step
        </Button>
      </div>
      <aside className="space-y-4">
        <section className="bg-card ring-foreground/6 rounded-card space-y-3 p-4 ring-1">
          <h2 className="heading text-base">When it sends</h2>
          <p className="text-muted-foreground text-sm">
            {windowLabel(win)}, {tz}.
          </p>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Days">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <button
                key={d}
                type="button"
                className={cn(chipClass(win.days.includes(d)), "h-8 px-2.5")}
                onClick={() => {
                  const days = win.days.includes(d) ? win.days.filter((x) => x !== d) : [...win.days, d].sort();
                  if (days.length) setWin({ ...win, days });
                  setDirty(true);
                }}
              >
                {DAY_NAMES[d]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Hours">
            {(
              [
                [8, 12, "Mornings"],
                [9, 17, "9 to 5"],
                [8, 20, "8 to 8"],
              ] as const
            ).map(([a, b, l]) => (
              <button
                key={l}
                type="button"
                className={cn(chipClass(win.startHour === a && win.endHour === b), "h-8 px-3")}
                onClick={() => {
                  setWin({ ...win, startHour: a, endHour: b });
                  setDirty(true);
                }}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 pt-1">
            <Label htmlFor="seq-reply">Stop when they reply</Label>
            <Switch
              id="seq-reply"
              checked={stopOnReply}
              onCheckedChange={(v) => {
                setStopOnReply(v);
                setDirty(true);
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="seq-book">Stop when they book a meeting</Label>
            <Switch
              id="seq-book"
              checked={stopOnBooking}
              onCheckedChange={(v) => {
                setStopOnBooking(v);
                setDirty(true);
              }}
            />
          </div>
          <p className="text-muted-foreground text-xs">Unsubscribes, bounces and do-not-contact always stop it.</p>
        </section>
        <section className="bg-card ring-foreground/6 rounded-card space-y-3 p-4 ring-1">
          <div className="flex items-center gap-2">
            <h2 className="heading flex-1 text-base">Who&apos;s in it</h2>
            <Button size="sm" variant="outline" disabled={sequence.status !== "ON"} onClick={() => setAdding(true)} title={sequence.status === "ON" ? undefined : "Turn it on first"}>
              <Users className="size-4" aria-hidden="true" />
              Add people
            </Button>
          </div>
          {enrollments.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nobody yet. Add people here, from a person&apos;s page, or from a campaign.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {enrollments.map((e) => (
                <li key={e.id} className="flex items-center gap-2">
                  <Link href={`/app/${orgSlug}/crm/people/${e.personId}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                    {e.name}
                  </Link>
                  <span className="text-muted-foreground shrink-0 text-xs" title={e.reason ?? undefined}>
                    {STATUS_WORDS[e.status] ?? e.status}
                    {e.status === "ACTIVE" ? `, step ${e.step + 1}${e.next ? ` ${e.next}` : ""}` : ""}
                  </span>
                  {(e.status === "ACTIVE" || e.status === "PAUSED") && (
                    <Button variant="ghost" size="xs" onClick={() => stop(e.id)}>
                      Stop
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        <Button variant="ghost" className="text-muted-foreground" onClick={archive}>
          Archive this sequence
        </Button>
      </aside>
      {adding && <EnrollDialog orgId={orgId} sequenceId={sequence.id} onClose={() => setAdding(false)} onDone={() => router.refresh()} />}
    </div>
  );
}

/** Adds people to a sequence; anyone another member is talking to is held back unless confirmed. */
export function EnrollDialog({
  orgId,
  sequenceId,
  sequences,
  personIds: given,
  onClose,
  onDone,
}: {
  orgId: string;
  sequenceId?: string;
  sequences?: { id: string; name: string }[];
  personIds?: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [people, setPeople] = useState<{ id: string; label: string }[]>([]);
  const [seq, setSeq] = useState(sequenceId ?? sequences?.[0]?.id ?? "");
  const [skipped, setSkipped] = useState<{ name: string; reason: string }[] | null>(null);
  const [pending, setPending] = useState(false);
  const ids = given ?? people.map((p) => p.id);
  const go = async (confirm: boolean) => {
    setPending(true);
    const r = await runAction(() => enrollAction(orgId, seq, ids, confirm));
    setPending(false);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    toast({ title: r.enrolled ? `Added ${r.enrolled}` : "Nobody added", tone: r.enrolled ? "success" : "default" });
    onDone();
    if (r.skipped.length) setSkipped(r.skipped);
    else onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to a sequence</DialogTitle>
          <DialogDescription>The steps go out from your mailbox, inside the sequence&apos;s hours.</DialogDescription>
        </DialogHeader>
        {skipped ? (
          <div className="space-y-2 text-sm">
            <p className="font-semibold">Held back:</p>
            <ul className="space-y-1">
              {skipped.map((s, i) => (
                <li key={i}>
                  <b>{s.name}</b> <span className="text-muted-foreground">{s.reason}</span>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Done
              </Button>
              {skipped.some((s) => / (has them|emailed|called|met|texted|was in touch)/.test(s.reason)) && (
                <Button disabled={pending} onClick={() => go(true)}>
                  Add them anyway
                </Button>
              )}
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            {sequences && sequences.length > 0 && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sequence">
                {sequences.map((s) => (
                  <button key={s.id} type="button" className={cn(chipClass(seq === s.id), "h-8 px-3")} onClick={() => setSeq(s.id)}>
                    {s.name}
                  </button>
                ))}
              </div>
            )}
            {!given && (
              <>
                <CrmPicker
                  orgId={orgId}
                  kind="person"
                  value={null}
                  placeholder="Add someone"
                  allowClear={false}
                  onPick={(hit) => hit && !people.some((p) => p.id === hit.id) && setPeople([...people, { id: hit.id, label: hit.label }])}
                />
                {people.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {people.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="bg-muted hover:bg-muted-strong rounded-full px-3 py-1 text-sm"
                        onClick={() => setPeople(people.filter((x) => x.id !== p.id))}
                        title="Remove"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={pending || !seq || ids.length === 0} onClick={() => go(false)}>
                <ArrowRight className="size-4" aria-hidden="true" />
                Add {ids.length || ""}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
