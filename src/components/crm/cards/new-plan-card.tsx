"use client";

import { AlertTriangle, ChevronDown, Send, ShieldCheck } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";

import {
  createCampaignAction,
  planBulkAction,
  sendBulkAction,
} from "@/app/app/[orgSlug]/crm/outreach/actions";
import { MemberMultiPicker } from "@/components/calendar/member-picker";
import { useCrmOpen } from "@/components/crm/card/use-crm-open";
import { MergeMenu } from "@/components/crm/outreach/compose";
import { Button } from "@/components/ui/button";
import {
  FormDialog,
  FormDialogBody,
  FormDialogFoot,
  FormDialogHead,
  FormError,
  FormField,
  FormRow,
  keepOpenForToasts,
} from "@/components/ui/form-dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { crmPlanHref } from "@/lib/crm/href";
import { exampleValues, renderMerge } from "@/lib/crm/outreach/merge";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

/**
 * A new plan that isn't steps over days (?open=plan:email or plan:split),
 * built like New task and New event (the shared FormDialog pieces): one
 * email to everyone on a list, from the organization's own sender, or a
 * list split among members, each reaching their share from their own
 * mailbox. The subject (or the plan's name) comes first and is focused;
 * Ctrl+Enter sends or starts it. Plain Enter doesn't send a bulk email:
 * pressing Send is the person's OK for it.
 */

type How = "email" | "sequence" | "event" | "form" | "call";

interface Choice {
  id: string;
  name: string;
}

const NO_TEMPLATE = "__none";

export function NewPlanCard({
  orgId,
  orgSlug,
  userId,
  what,
  lists,
  templates,
  sequences,
  events,
  forms,
  members,
  sender,
  canSend,
  initialList = null,
}: {
  orgId: string;
  orgSlug: string;
  userId: string;
  what: "email" | "split";
  lists: { id: string; name: string; count: number; emailable: number }[];
  templates: { id: string; name: string; subject: string | null; body: string }[];
  sequences: Choice[];
  events: Choice[];
  forms: Choice[];
  members: Choice[];
  sender: { ok: boolean; from: string | null; problem: string | null } | null;
  canSend: boolean;
  /** A list to start from (People's "Email them"). */
  initialList?: string | null;
}) {
  if (what === "email") {
    return (
      <EmailForm
        orgId={orgId}
        orgSlug={orgSlug}
        lists={lists.map((l) => ({ id: l.id, name: l.name, count: l.emailable }))}
        templates={templates}
        sender={
          sender ?? { ok: false, from: null, problem: "We couldn't check your sender just now." }
        }
        canSend={canSend}
        initialList={initialList}
      />
    );
  }
  return (
    <SplitForm
      orgId={orgId}
      orgSlug={orgSlug}
      userId={userId}
      lists={lists}
      choices={{ email: templates, sequence: sequences, event: events, form: forms, call: [] }}
      members={members}
    />
  );
}

/** Ctrl+Enter (or Cmd+Enter) submits; plain Enter in a field doesn't. */
function onlyModEnter(e: React.KeyboardEvent<HTMLFormElement>) {
  if (e.key !== "Enter") return;
  if (e.metaKey || e.ctrlKey) {
    e.preventDefault();
    e.currentTarget.requestSubmit();
    return;
  }
  if (e.target instanceof HTMLInputElement) e.preventDefault();
}

/**
 * One email to a list: who it reaches and who's left out (and why), the
 * sender check, the message with merge fields and how it reads, then Send.
 * Owners, admins and CRM managers send it, only from the organization's
 * own verified domain.
 */
function EmailForm({
  orgId,
  orgSlug,
  lists,
  templates,
  sender,
  canSend,
  initialList,
}: {
  orgId: string;
  orgSlug: string;
  lists: { id: string; name: string; count: number }[];
  templates: { id: string; name: string; subject: string | null; body: string }[];
  sender: { ok: boolean; from: string | null; problem: string | null };
  canSend: boolean;
  initialList: string | null;
}) {
  const router = useRouter();
  const { close } = useCrmOpen();
  const ids = useId();
  const id = (field: string) => `${ids}-${field}`;
  const startList = initialList && lists.some((l) => l.id === initialList) ? initialList : null;
  const [viewId, setViewId] = useState<string | null>(startList);
  const [plan, setPlan] = useState<{
    recipients: number;
    left: { reason: string; count: number }[];
  } | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState(
    "Hi {{first_name|there}},\n\n\n\n{{my_first_name}}\n{{organization}}",
  );
  const [showPreview, setShowPreview] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useMemo(() => {
    const v = exampleValues();
    return { subject: renderMerge(subject, v).text, body: renderMerge(body, v).text };
  }, [subject, body]);

  useEffect(() => {
    if (!startList) return;
    let live = true;
    void planBulkAction(orgId, startList)
      .then((r) => {
        if (live && r.ok) setPlan(r.plan);
      })
      .catch(() => null);
    return () => {
      live = false;
    };
  }, [orgId, startList]);

  const pickList = async (next: string) => {
    setViewId(next);
    setPlan(null);
    const r = await runAction(() => planBulkAction(orgId, next));
    if (!r) return;
    if (!r.ok) return setError(r.error);
    setPlan(r.plan);
  };

  const pickTemplate = (next: string) => {
    if (next === NO_TEMPLATE) return setTemplateId(null);
    const t = templates.find((x) => x.id === next);
    if (!t) return;
    setTemplateId(t.id);
    setSubject(t.subject ?? "");
    setBody(t.body);
  };

  const ready =
    canSend &&
    sender.ok &&
    Boolean(plan?.recipients) &&
    Boolean(subject.trim()) &&
    Boolean(body.trim());

  const send = async () => {
    if (!viewId || !ready || pending) return;
    setError(null);
    setPending(true);
    const r = await runAction(() => sendBulkAction(orgId, { viewId, subject, body, templateId }));
    setPending(false);
    if (!r) return;
    if (!r.ok) return setError(r.error);
    toast({ title: `Sending to ${r.recipients.toLocaleString("en-US")}`, tone: "success" });
    router.push(crmPlanHref(orgSlug, "campaign", r.campaignId));
  };

  return (
    <FormDialog open onOpenChange={(o) => !o && close()} onInteractOutside={keepOpenForToasts}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        onKeyDown={onlyModEnter}
        className="flex min-h-0 flex-1 flex-col"
      >
        <FormDialogHead
          title="One email to a list"
          description="From your organization's own address, each merged for its person."
        />

        <FormDialogBody>
          <FormField label="Subject" htmlFor={id("subject")}>
            <Input
              id={id("subject")}
              autoFocus
              required
              maxLength={300}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. You're invited to the spring showcase"
            />
          </FormField>

          <FormRow>
            <FormField
              label="List"
              htmlFor={id("list")}
              hint={
                lists.length === 0 ? (
                  <>
                    Save a view of people first, on{" "}
                    <Link
                      href={`/app/${orgSlug}/crm/people`}
                      className="text-foreground underline underline-offset-4"
                    >
                      People
                    </Link>
                    .
                  </>
                ) : plan ? (
                  [
                    `${plan.recipients.toLocaleString("en-US")} will get it.`,
                    ...plan.left.map((l) => `${l.count} left out: ${l.reason}.`),
                  ].join(" ")
                ) : viewId ? (
                  "Counting who it reaches…"
                ) : undefined
              }
            >
              <Select
                value={viewId ?? undefined}
                onValueChange={(v) => void pickList(v)}
                disabled={lists.length === 0}
              >
                <SelectTrigger id={id("list")} className="w-full">
                  <SelectValue placeholder="Pick a list" />
                </SelectTrigger>
                <SelectContent>
                  {lists.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      <span className="truncate">{l.name}</span>
                      <span className="text-muted-foreground tabular-nums">{l.count}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Template" htmlFor={id("template")}>
              <Select
                value={templateId ?? NO_TEMPLATE}
                onValueChange={pickTemplate}
                disabled={templates.length === 0}
              >
                <SelectTrigger id={id("template")} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TEMPLATE}>
                    {templates.length === 0 ? "No templates yet" : "Write your own"}
                  </SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </FormRow>

          <FormField
            label="From"
            labelId={id("from")}
            hint={
              sender.ok ? (
                "Its domain is verified, so SPF and DKIM are in place. Every email has a one-click unsubscribe."
              ) : (
                <>
                  {sender.problem}{" "}
                  <Link
                    href={`/app/${orgSlug}/integrations`}
                    className="text-foreground underline underline-offset-4"
                  >
                    Integrations and apps
                  </Link>
                </>
              )
            }
          >
            <div
              aria-labelledby={id("from")}
              className={cn(
                "rounded-field flex h-10 items-center gap-2 border px-3.5 text-sm",
                sender.ok ? "border-input bg-muted/40" : "border-destructive/40 bg-tint-danger/40",
              )}
            >
              {sender.ok ? (
                <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
              ) : (
                <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
              )}
              <span className="min-w-0 truncate">
                {sender.ok ? sender.from : "Your organization's own sender isn't set up"}
              </span>
            </div>
          </FormField>

          <div className="grid content-start gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={id("body")} className="text-sm leading-none font-medium">
                Message
              </label>
              <MergeMenu onPick={(k) => setBody(`${body}{{${k}}}`)} />
            </div>
            <Textarea
              id={id("body")}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
            />
          </div>

          <div>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1.5 border-t pt-3 text-sm font-medium transition-colors"
              aria-expanded={showPreview}
              aria-controls={id("preview")}
              onClick={() => setShowPreview((v) => !v)}
            >
              <ChevronDown
                aria-hidden
                className={cn("size-4 transition-transform", showPreview && "rotate-180")}
              />
              {showPreview ? "Hide how it reads" : "How it reads"}
            </button>
          </div>
          {showPreview && (
            <div id={id("preview")} className="grid gap-1.5">
              <div className="bg-muted/50 rounded-field space-y-2 p-4">
                <p className="text-sm font-semibold">{preview.subject || "(no subject)"}</p>
                <p className="text-sm whitespace-pre-wrap">{preview.body}</p>
                <p className="text-muted-foreground border-t pt-2 text-xs">
                  Don&apos;t want these emails? Unsubscribe.
                </p>
              </div>
              <p className="text-muted-foreground text-xs">
                With example values; each person gets their own.
              </p>
            </div>
          )}

          {!canSend && (
            <p className="text-muted-foreground text-sm">
              Owners, admins and CRM managers send bulk email.
            </p>
          )}
          <FormError>{error}</FormError>
        </FormDialogBody>

        <FormDialogFoot>
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!ready || pending}
            title={canSend ? "Ctrl+Enter" : "Owners, admins and CRM managers send bulk email"}
          >
            <Send className="size-4" aria-hidden="true" />
            {pending
              ? "Sending…"
              : `Send to ${plan?.recipients ? plan.recipients.toLocaleString("en-US") : "the list"}`}
          </Button>
        </FormDialogFoot>
      </form>
    </FormDialog>
  );
}

function SplitForm({
  orgId,
  orgSlug,
  userId,
  lists,
  choices,
  members,
}: {
  orgId: string;
  orgSlug: string;
  userId: string;
  lists: { id: string; name: string; count: number }[];
  choices: Record<How, Choice[]>;
  members: Choice[];
}) {
  const { setOpen, close } = useCrmOpen();
  const ids = useId();
  const id = (field: string) => `${ids}-${field}`;
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [viewId, setViewId] = useState<string | null>(lists[0]?.id ?? null);
  const [how, setHow] = useState<How>("email");
  const [pick, setPick] = useState<string | null>(null);
  const [split, setSplit] = useState<string[]>([userId]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready =
    Boolean(name.trim()) &&
    Boolean(viewId) &&
    split.length > 0 &&
    (how === "call" || Boolean(pick));

  const create = async () => {
    if (!viewId || !ready || pending) return;
    setError(null);
    setPending(true);
    const r = await runAction(() =>
      createCampaignAction(orgId, {
        name,
        goal,
        dueOn: dueOn || null,
        viewId,
        channel: how,
        templateId: how === "email" ? pick : null,
        sequenceId: how === "sequence" ? pick : null,
        eventId: how === "event" ? pick : null,
        formId: how === "form" ? pick : null,
        memberIds: split,
      }),
    );
    setPending(false);
    if (!r) return;
    if (!r.ok) return setError(r.error);
    toast({ title: `${r.people} people split among ${split.length}`, tone: "success" });
    setOpen({ kind: "plan", type: "campaign", id: r.id });
  };

  const empty: Record<How, string> = {
    email: "No templates yet",
    sequence: "No plan with steps is running",
    event: "No upcoming event with an RSVP page",
    form: "No published forms",
    call: "",
  };
  const which: Record<How, string> = {
    email: "Template",
    sequence: "Plan",
    event: "Event",
    form: "Form",
    call: "",
  };

  return (
    <FormDialog open onOpenChange={(o) => !o && close()} onInteractOutside={keepOpenForToasts}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
        onKeyDown={onlyModEnter}
        className="flex min-h-0 flex-1 flex-col"
      >
        <FormDialogHead
          title="Split a list among members"
          description="Each member gets their share in Today and reaches them from their own mailbox."
        />

        <FormDialogBody>
          <FormField label="Name" htmlFor={id("name")}>
            <Input
              id={id("name")}
              autoFocus
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Reach every donor before the showcase"
            />
          </FormField>

          <FormRow>
            <FormField label="Goal" htmlFor={id("goal")}>
              <Input
                id={id("goal")}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="Optional"
              />
            </FormField>
            <FormField label="Due" htmlFor={id("due")}>
              <Input
                id={id("due")}
                type="date"
                value={dueOn}
                onChange={(e) => setDueOn(e.target.value)}
              />
            </FormField>
          </FormRow>

          <FormField
            label="List"
            htmlFor={id("list")}
            hint={
              lists.length === 0 ? (
                <>
                  Save a view of people first, on{" "}
                  <Link
                    href={`/app/${orgSlug}/crm/people`}
                    className="text-foreground underline underline-offset-4"
                  >
                    People
                  </Link>
                  .
                </>
              ) : undefined
            }
          >
            <Select
              value={viewId ?? undefined}
              onValueChange={setViewId}
              disabled={lists.length === 0}
            >
              <SelectTrigger id={id("list")} className="w-full">
                <SelectValue placeholder="Pick a list" />
              </SelectTrigger>
              <SelectContent>
                {lists.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    <span className="truncate">{l.name}</span>
                    <span className="text-muted-foreground tabular-nums">{l.count}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormRow>
            <FormField label="How to reach them" htmlFor={id("how")}>
              <Select
                value={how}
                onValueChange={(v) => {
                  setHow(v as How);
                  setPick(null);
                }}
              >
                <SelectTrigger id={id("how")} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">An email</SelectItem>
                  <SelectItem value="sequence">A plan with steps</SelectItem>
                  <SelectItem value="event">Invite to an event</SelectItem>
                  <SelectItem value="form">Invite to a form</SelectItem>
                  <SelectItem value="call">Calls</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            {how !== "call" && (
              <FormField label={which[how]} htmlFor={id("which")}>
                <Select
                  value={pick ?? undefined}
                  onValueChange={setPick}
                  disabled={choices[how].length === 0}
                >
                  <SelectTrigger id={id("which")} className="w-full">
                    <SelectValue
                      placeholder={choices[how].length === 0 ? empty[how] : "Pick one"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {choices[how].map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          </FormRow>

          <FormField label="Split among" htmlFor={id("split")}>
            <MemberMultiPicker
              id={id("split")}
              members={members.map((m) => ({
                id: m.id,
                name: m.name,
                image: null,
                avatar: null,
                title: null,
              }))}
              selectedIds={split}
              onChange={setSplit}
              placeholder="Pick who shares it"
            />
          </FormField>

          <FormError>{error}</FormError>
        </FormDialogBody>

        <FormDialogFoot>
          <span className="text-muted-foreground self-center text-sm sm:me-auto">
            {viewId
              ? `${lists.find((l) => l.id === viewId)?.count ?? 0} people, split among ${split.length}`
              : "Pick who it's for"}
          </span>
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={!ready || pending} title="Ctrl+Enter">
            {pending ? "Starting…" : "Start it"}
          </Button>
        </FormDialogFoot>
      </form>
    </FormDialog>
  );
}
