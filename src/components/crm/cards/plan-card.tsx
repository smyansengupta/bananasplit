"use client";

import {
  Clock,
  ListChecks,
  Mail,
  MessageSquare,
  Minus,
  Phone,
  Plus,
  Send,
  Trash2,
  X,
} from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import {
  archiveSequenceAction,
  enrollShareAction,
  refreshCampaignAction,
  saveSequenceAction,
  savePlanSettingsAction,
  setCampaignStatusAction,
  setSequenceStatusAction,
  setTargetStatusAction,
  startPlanAction,
  type PlanSettingsInput,
} from "@/app/app/[orgSlug]/crm/outreach/actions";
import { AmbientButton, AmbientWhy, type AmbientAction } from "@/components/ambient/ambient-button";
import { CrmAvatar, CrmCard } from "@/components/crm/card/crm-card";
import { useCrmOpen } from "@/components/crm/card/use-crm-open";
import { ShareSender, type TargetRow } from "@/components/crm/outreach/campaign-view";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { emailTells } from "@/lib/crm/email-style";
import {
  shortenText,
  stepCap,
  stepDays,
  stepKey,
  stepsToUi,
  stepTitle,
  textTooLong,
  uiToSteps,
  type Audience,
  type AudienceChip,
  type FunnelBar,
  type PlanExtras,
  type PlanStatus,
  type StoredStep,
  type UiStep,
  type UiStepKind,
} from "@/lib/crm/outreach/plans";
import type { CrmStepKind } from "@/generated/prisma/enums";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

/**
 * A plan (a follow-up series, a split list, one email to many) as a card over the page (?open=plan:...), per
 * the OutreachPlan design: Steps (edited in place: Email, Wait, Text,
 * Task), Who (plain-language chips, how many, who's left out and why),
 * Results (sent, opened, replied as bars, and who replied) and Settings
 * (who sends, the daily cap, stop when they reply). The foot says where it
 * stands, with Pause or Start. A campaign (a list split among members, or
 * one email to a list) opens the same way, its steps fixed once it started.
 */

export interface PlanReply {
  personId: string;
  name: string;
  when: string;
  text: string;
  /** Why it needs an answer, when nobody has answered. */
  why: string | null;
}

interface PlanResults {
  bars: FunnelBar[];
  replies: PlanReply[];
  since: string | null;
  next: string | null;
}

export interface SequencePlanData {
  type: "sequence";
  id: string;
  name: string;
  status: PlanStatus;
  statusText: string;
  steps: StoredStep[];
  templates: { id: string; name: string }[];
  stopOnReply: boolean;
  window: string;
  extras: PlanExtras;
  orgCap: number;
  me: string;
  orgName: string;
  who: {
    set: boolean;
    chips: AudienceChip[];
    offers: AudienceChip[];
    count: number;
    inIt: number;
    /** Everyone ever put in it. */
    enrolled: number;
    /** Match today and are neither in it nor left out. */
    notYet: number;
    sample: { id: string; name: string }[];
    excluded: { personId: string; name: string; why: string; canInclude: boolean }[];
    excludedCount: number;
    include: string[];
  };
  results: PlanResults;
}

export interface CampaignPlanData {
  type: "campaign";
  id: string;
  name: string;
  status: PlanStatus;
  shape: "email" | "split";
  channel: string;
  statusText: string;
  goal: string | null;
  due: string | null;
  sequenceId: string | null;
  steps: {
    kind: "email" | "text" | "task" | "call";
    title: string;
    subject: string | null;
    body: string | null;
    note: string | null;
  }[];
  message: { subject: string; body: string } | null;
  who: {
    listName: string | null;
    chips: AudienceChip[];
    count: number;
    newOnList: number;
    byMember: { name: string; total: number; contacted: number; replied: number }[];
    rows: TargetRow[];
  };
  results: PlanResults;
  members: { id: string; name: string }[];
  userId: string;
}

const TONE: Record<UiStepKind, string> = {
  email: "var(--tag-navy)",
  text: "var(--tag-forest)",
  task: "var(--tag-ochre)",
  call: "var(--tag-ochre)",
  linkedin: "var(--tag-teal)",
  wait: "var(--muted-foreground)",
};

const ICON: Record<UiStepKind, typeof Mail> = {
  email: Mail,
  text: MessageSquare,
  task: ListChecks,
  call: Phone,
  linkedin: ListChecks,
  wait: Clock,
};

function StepMark({ kind }: { kind: UiStepKind }) {
  const Icon = ICON[kind];
  return (
    <span
      aria-hidden="true"
      className="text-foreground grid size-9 shrink-0 place-items-center rounded-full"
      style={{ background: `color-mix(in oklab, ${TONE[kind]} 20%, var(--card))` }}
    >
      <Icon className="size-4" />
    </span>
  );
}

function PlanMark() {
  return (
    <span
      aria-hidden="true"
      className="grid size-[52px] shrink-0 place-items-center rounded-full"
      style={{ background: "color-mix(in oklab, var(--tag-ochre) 24%, var(--card))" }}
    >
      <Send className="size-5" />
    </span>
  );
}

function StatusFoot({
  status,
  text,
  children,
}: {
  status: PlanStatus;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <span
        aria-hidden="true"
        className={cn(
          "size-2.5 shrink-0 rounded-full",
          status === "running"
            ? "bg-(--success)"
            : status === "done"
              ? "bg-foreground/40"
              : "bg-muted-foreground/50",
        )}
      />
      <span className="min-w-0 flex-1 text-sm">{text}</span>
      {children}
    </div>
  );
}

function Bars({ bars }: { bars: FunnelBar[] }) {
  return (
    <div className="space-y-3">
      {bars.map((b, i) => (
        <div key={b.label} className="flex items-center gap-3.5 text-[15px]">
          <span className="w-[70px] shrink-0">{b.label}</span>
          <div className="bg-muted h-[26px] min-w-0 flex-1 overflow-hidden rounded-full">
            <div
              className={cn(
                "h-full rounded-full",
                i === bars.length - 1
                  ? "bg-foreground"
                  : i === 0
                    ? "bg-foreground/35"
                    : "bg-foreground/60",
              )}
              style={{ width: `${Math.round(b.share * 100)}%` }}
            />
          </div>
          <b className="w-10 shrink-0 text-end tabular-nums">{b.n.toLocaleString("en-US")}</b>
          <span className="text-muted-foreground w-11 shrink-0 text-[13px] tabular-nums">
            {b.pct}
          </span>
        </div>
      ))}
    </div>
  );
}

function Replies({ replies }: { replies: PlanReply[] }) {
  const { hrefFor } = useCrmOpen();
  if (replies.length === 0)
    return <p className="text-muted-foreground text-sm">Nobody has replied yet.</p>;
  return (
    <div className="flex flex-col">
      <b className="pb-1.5 text-[15px]">Who replied</b>
      {replies.map((r) => (
        <div key={r.personId} className="border-border/60 flex flex-col gap-1.5 border-t py-3">
          <div className="flex items-center gap-2.5 text-[15px]">
            <CrmAvatar name={r.name} size={32} />
            <a
              href={hrefFor({ kind: "person", id: r.personId })}
              className="font-semibold hover:underline"
            >
              {r.name}
            </a>
            <span className="text-muted-foreground ms-auto text-[13px]">{r.when}</span>
          </div>
          {r.text && (
            <span className="text-muted-foreground ps-[42px] text-sm">&ldquo;{r.text}&rdquo;</span>
          )}
          {r.why && (
            <span className="flex flex-nowrap items-center gap-2.5 ps-[42px]">
              <AmbientButton
                action={{
                  key: "reply",
                  label: "Reply",
                  tone: "solid",
                  reason: r.why,
                  href: hrefFor({ kind: "person", id: r.personId }),
                }}
              />
              <AmbientWhy className="min-w-0 truncate">{r.why}</AmbientWhy>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function Row({ label, sub, children }: { label: string; sub?: string; children: ReactNode }) {
  return (
    <div className="border-border/60 flex flex-wrap items-center gap-3 border-t py-3.5 first:border-t-0">
      <span className="min-w-0 flex-1 text-[15px]">
        {label}
        {sub && <span className="text-muted-foreground block pt-0.5 text-[13px]">{sub}</span>}
      </span>
      {children}
    </div>
  );
}

export function PlanCard({
  orgId,
  data,
}: {
  orgId: string;
  data: SequencePlanData | CampaignPlanData | null;
}) {
  if (!data) {
    return (
      <CrmCard title="Not here">
        <EmptyState
          title="This plan isn't here any more"
          description="It may have been archived, or you can't see it."
        />
      </CrmCard>
    );
  }
  return data.type === "sequence" ? (
    <SequencePlan orgId={orgId} data={data} />
  ) : (
    <CampaignPlan orgId={orgId} data={data} />
  );
}

// ---------------------------------------------------------------- a sequence

const ADD_KINDS: { kind: UiStepKind; label: string }[] = [
  { kind: "email", label: "Email" },
  { kind: "wait", label: "Wait" },
  { kind: "text", label: "Text" },
  { kind: "task", label: "Task" },
  { kind: "call", label: "Call" },
];

function newStep(kind: UiStepKind): UiStep {
  const key = stepKey();
  if (kind === "wait") return { key, kind, days: 2, hours: 0 };
  if (kind === "email")
    return {
      key,
      kind,
      subject: "",
      body: "Hi {{first_name|there}},\n\n\n\n{{my_first_name}}",
      templateId: null,
    };
  if (kind === "text") return { key, kind, body: "Hi {{first_name|there}}, " };
  if (kind === "call") return { key, kind, title: "" };
  return { key, kind, title: "" };
}

/** Merge fields aren't tells: they become real words when it sends. */
function tellsOf(step: UiStep): string[] {
  const text = `${step.subject ?? ""}\n${step.body ?? ""}`.replace(/\{\{[^}\n]{0,40}\}\}/g, "Sam");
  return emailTells(text);
}

function SequencePlan({ orgId, data }: { orgId: string; data: SequencePlanData }) {
  const router = useRouter();
  const { close } = useCrmOpen();
  const [tab, setTab] = useState("steps");
  const [steps, setSteps] = useState<UiStep[]>(() => stepsToUi(data.steps));
  const [dirty, setDirty] = useState(false);
  const [adding, setAdding] = useState(false);
  const [extras, setExtras] = useState<PlanExtras>(data.extras);
  const [stopOn, setStopOn] = useState(data.stopOnReply);
  const [name, setName] = useState(data.name);
  const [busy, setBusy] = useState(false);
  const days = stepDays(steps);
  const running = data.status === "running";

  const change = (key: string, patch: Partial<UiStep>) => {
    setSteps((list) => list.map((s) => (s.key === key ? { ...s, ...patch } : s)));
    setDirty(true);
  };

  /** Saves the steps; the error in words, or null once saved. */
  const saveSteps = async (): Promise<string | null> => {
    const stored = uiToSteps(steps);
    const r = await runAction(() =>
      saveSequenceAction(orgId, data.id, {
        steps: stored.map((s) => ({ ...s, kind: s.kind as CrmStepKind })),
      }),
    );
    if (!r) return "That didn't save. Try again.";
    if (!r.ok) return r.error;
    setDirty(false);
    return null;
  };

  const settings = async (input: PlanSettingsInput, done?: string) => {
    const r = await runAction(() => savePlanSettingsAction(orgId, data.id, input));
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    setExtras(r.extras);
    if (done) toast({ title: done });
    router.refresh();
  };

  const setWho = (who: Audience) => settings({ who });

  const start = async () => {
    setBusy(true);
    if (dirty) {
      const error = await saveSteps();
      if (error) {
        setBusy(false);
        return toast({ title: error, tone: "error" });
      }
    }
    const r = await runAction(() => startPlanAction(orgId, data.id));
    setBusy(false);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    toast({
      title: r.enrolled
        ? `Started for ${r.enrolled} ${r.enrolled === 1 ? "person" : "people"}`
        : "Started",
      description: r.skipped
        ? `${r.skipped} held back: someone reached them lately, or they can't be emailed.`
        : undefined,
    });
    router.refresh();
  };

  const pause = async () => {
    setBusy(true);
    const r = await runAction(() => setSequenceStatusAction(orgId, data.id, "OFF"));
    setBusy(false);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    toast({ title: "Paused" });
    router.refresh();
  };

  const who = data.who;
  const sender = extras.from === "owner" ? "sent by each person's owner" : `sent by ${data.me}`;
  const count = running || data.status === "paused" ? who.enrolled : who.count;

  return (
    <CrmCard
      title={data.name}
      subtitle={`${count.toLocaleString("en-US")} ${count === 1 ? "person" : "people"}, ${sender}`}
      avatar={<PlanMark />}
      description={`${data.name}: steps, who, results and settings`}
      menu={
        <DropdownMenuItem
          onSelect={async () => {
            const r = await runAction(() => archiveSequenceAction(orgId, data.id));
            if (r && !r.ok) return toast({ title: r.error, tone: "error" });
            toast({ title: "Archived. Anyone still in it stopped." });
            close();
            router.refresh();
          }}
        >
          <Trash2 className="size-4" aria-hidden="true" />
          Archive this plan
        </DropdownMenuItem>
      }
      menuLabel="More: archive"
      tabs={[
        { value: "steps", label: "Steps" },
        { value: "who", label: "Who" },
        { value: "results", label: "Results" },
        { value: "settings", label: "Settings" },
      ]}
      tab={tab}
      onTab={setTab}
      foot={
        <StatusFoot status={data.status} text={dirty ? "Changed, not saved yet." : data.statusText}>
          {dirty && (
            <span className="flex flex-nowrap items-center gap-2">
              <AmbientWhy>Your edits to the steps</AmbientWhy>
              <AmbientButton
                action={{
                  key: "save",
                  label: "Save",
                  tone: "outline",
                  reason: "Your edits to the steps",
                  done: "Saved",
                  run: async () => {
                    const error = await saveSteps();
                    return error ? { error } : {};
                  },
                }}
              />
            </span>
          )}
          {running ? (
            <Button variant="outline" disabled={busy} onClick={pause}>
              Pause
            </Button>
          ) : (
            <Button disabled={busy || steps.every((s) => s.kind === "wait")} onClick={start}>
              Start
            </Button>
          )}
        </StatusFoot>
      }
    >
      {(t) => {
        if (t === "who") {
          return (
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap items-center gap-2 text-[15px]">
                <span>People who are</span>
                {who.chips.length === 0 && (
                  <span className="text-muted-foreground">anyone you pick</span>
                )}
                {who.chips.map((c) => (
                  <span
                    key={`${c.key}-${c.value}`}
                    className="bg-muted inline-flex h-9 items-center gap-1.5 rounded-full ps-3.5 pe-1.5 text-sm font-semibold"
                  >
                    {c.label}
                    <button
                      type="button"
                      aria-label={`Remove ${c.label}`}
                      className="hover:bg-foreground/10 grid size-6 place-items-center rounded-full"
                      onClick={() => setWho({ ...extras.who, [c.key]: null })}
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  </span>
                ))}
                {who.offers.map((c) => (
                  <button
                    key={`${c.key}-${c.value}`}
                    type="button"
                    onClick={() => setWho({ ...extras.who, [c.key]: c.value })}
                    className="text-muted-foreground hover:text-foreground border-input inline-flex h-9 items-center rounded-full border border-dashed px-3.5 text-sm font-semibold"
                  >
                    + {c.label}
                  </button>
                ))}
              </div>
              {who.set ? (
                <>
                  <div className="flex flex-wrap items-baseline gap-3">
                    <span className="display-title text-[56px] leading-none tabular-nums">
                      {who.count.toLocaleString("en-US")}
                    </span>
                    <span className="text-lg font-semibold">
                      {who.count === 1 ? "person" : "people"}
                    </span>
                    <span className="text-muted-foreground text-sm">
                      match today{who.inIt ? `, ${who.inIt} in it now` : ""}
                    </span>
                  </div>
                  {running && who.notYet > 0 && (
                    <span className="flex flex-nowrap items-center gap-2.5">
                      <AmbientButton
                        action={{
                          key: "add",
                          label: `Add the ${who.notYet}`,
                          tone: "solid",
                          reason: `${who.notYet} match and aren't in it yet`,
                          run: () => startPlanAction(orgId, data.id),
                          done: "Added",
                        }}
                      />
                      <AmbientWhy className="min-w-0 truncate">
                        {who.notYet} match and aren&apos;t in it yet
                      </AmbientWhy>
                    </span>
                  )}
                  {who.sample.length > 0 && (
                    <div className="flex items-center gap-2.5">
                      <div className="flex">
                        {who.sample.map((p, i) => (
                          <span
                            key={p.id}
                            className={cn(
                              "ring-background rounded-full ring-2",
                              i > 0 && "-ms-2.5",
                            )}
                          >
                            <CrmAvatar name={p.name} size={34} />
                          </span>
                        ))}
                      </div>
                      <span className="text-sm">
                        {who.sample.map((p) => p.name).join(", ")}
                        {who.count > who.sample.length
                          ? ` and ${who.count - who.sample.length} more`
                          : ""}
                      </span>
                    </div>
                  )}
                  <div className="flex flex-col">
                    <b className="pb-1.5 text-[15px]">
                      {who.excludedCount ? `${who.excludedCount} left out` : "Nobody left out"}
                    </b>
                    {who.excluded.map((x) => (
                      <div
                        key={x.personId}
                        className="border-border/60 flex flex-wrap items-center gap-2.5 border-t py-3 text-[15px]"
                      >
                        <b className="w-[140px] shrink-0 truncate">{x.name}</b>
                        <span className="text-muted-foreground min-w-0 flex-[1_1_200px] text-sm">
                          {x.why}
                        </span>
                        {x.canInclude && (
                          <AmbientButton
                            action={{
                              key: "include",
                              label: "Include anyway",
                              tone: "outline",
                              reason: x.why,
                              run: async () => {
                                const r = await savePlanSettingsAction(orgId, data.id, {
                                  include: [...extras.include, x.personId],
                                });
                                if (r.ok) setExtras(r.extras);
                                return r;
                              },
                              done: `${x.name} is in`,
                            }}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {who.enrolled > 0
                    ? `${who.enrolled} ${who.enrolled === 1 ? "person was" : "people were"} added by hand. `
                    : ""}
                  Pick who it&apos;s for above. People who asked not to be contacted, unsubscribed,
                  bounced or are already in another plan are left out, each with the reason.
                </p>
              )}
            </div>
          );
        }
        if (t === "results") {
          return (
            <div className="flex flex-col gap-6">
              <div className="space-y-3.5">
                <Bars bars={data.results.bars} />
                {(data.results.since || data.results.next) && (
                  <span className="text-muted-foreground block text-[13px]">
                    {[
                      data.results.since ? `Since ${data.results.since}.` : null,
                      data.results.next ? `${data.results.next}.` : null,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  </span>
                )}
              </div>
              <Replies replies={data.results.replies} />
            </div>
          );
        }
        if (t === "settings") {
          return (
            <div className="flex flex-col">
              <Row label="Name">
                <Input
                  value={name}
                  aria-label="Name"
                  className="w-64 max-w-full"
                  onChange={(e) => setName(e.target.value)}
                  onBlur={async () => {
                    if (name.trim() === data.name || !name.trim()) return;
                    const r = await runAction(() => saveSequenceAction(orgId, data.id, { name }));
                    if (r && !r.ok) toast({ title: r.error, tone: "error" });
                    else router.refresh();
                  }}
                />
              </Row>
              <Row label="Send from">
                <Segmented
                  label="Send from"
                  value={extras.from}
                  onSelect={(v) => settings({ from: v as PlanExtras["from"] })}
                  options={[
                    { value: "owner", label: "Their owner" },
                    { value: "me", label: data.me },
                  ]}
                />
              </Row>
              <Row
                label="Most sent a day"
                sub={`The organization's cap is ${data.orgCap} a day for each member.`}
              >
                <span className="border-input inline-flex items-center gap-1 rounded-full border p-1">
                  <button
                    type="button"
                    aria-label="Fewer"
                    className="bg-muted hover:bg-muted/70 grid size-8 place-items-center rounded-full"
                    onClick={() =>
                      settings({ dailyCap: stepCap(extras.dailyCap, -10, data.orgCap) })
                    }
                  >
                    <Minus className="size-3.5" aria-hidden="true" />
                  </button>
                  <b className="w-11 text-center tabular-nums">
                    {extras.dailyCap ?? Math.min(data.orgCap, 200)}
                  </b>
                  <button
                    type="button"
                    aria-label="More"
                    className="bg-muted hover:bg-muted/70 grid size-8 place-items-center rounded-full"
                    onClick={() =>
                      settings({ dailyCap: stepCap(extras.dailyCap, 10, data.orgCap) })
                    }
                  >
                    <Plus className="size-3.5" aria-hidden="true" />
                  </button>
                </span>
              </Row>
              <Row
                label="Stop when they reply"
                sub="Also stops when they book a meeting or ask not to be emailed"
              >
                <Switch
                  checked={stopOn}
                  aria-label="Stop when they reply"
                  onCheckedChange={(v) => {
                    setStopOn(v);
                    void settings({ stopOnReply: v });
                  }}
                />
              </Row>
              <Row label="Sends">
                <span className="text-muted-foreground text-sm">
                  {data.window}, in the organization&apos;s time
                </span>
              </Row>
              <span className="text-muted-foreground pt-2 text-[13px]">
                Click a value to change it.
              </span>
            </div>
          );
        }
        return (
          <div className="flex flex-col gap-1">
            <div className="bg-muted mb-2.5 rounded-[20px] px-3.5 py-2.5 text-sm">
              Drafts follow {data.orgName}&apos;s writing rules: one purpose, the real names and
              dates, plain words, no dashes, usually under 150 words.
            </div>
            {steps.map((s, i) => {
              const tells = s.kind === "email" ? tellsOf(s) : [];
              const dashes = tells.some((x) => x.startsWith("em or en dashes"));
              const day = days[i];
              const remove = () => {
                setSteps((list) => list.filter((x) => x.key !== s.key));
                setDirty(true);
              };
              return (
                <div key={s.key} className="flex gap-3.5">
                  <div className="flex shrink-0 flex-col items-center">
                    <StepMark kind={s.kind} />
                    <span
                      className={cn(
                        "min-h-3.5 w-0.5 flex-1",
                        i === steps.length - 1 ? "bg-transparent" : "bg-border",
                      )}
                    />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5 pb-4">
                    <div className="flex min-h-9 items-center gap-2.5">
                      {s.kind === "wait" ? (
                        <span className="flex items-center gap-2 text-[15px] font-semibold">
                          Wait
                          <Input
                            type="number"
                            min={0}
                            max={365}
                            value={s.days ?? 0}
                            aria-label="Days to wait"
                            className="h-8 w-16 px-2 text-center"
                            onChange={(e) =>
                              change(s.key, {
                                days: Math.max(0, Math.min(365, Number(e.target.value) || 0)),
                              })
                            }
                          />
                          {(s.days ?? 0) === 1 ? "day" : "days"}
                        </span>
                      ) : (
                        <b className="text-[15px]">{stepTitle(s, steps[i - 1] ?? null)}</b>
                      )}
                      {day !== null && (
                        <span className="text-muted-foreground text-[13px]">Day {day}</span>
                      )}
                      <span className="flex-1" />
                      <button
                        type="button"
                        aria-label="Remove this step"
                        title="Remove"
                        onClick={remove}
                        className="text-muted-foreground hover:bg-muted grid size-[30px] place-items-center rounded-full"
                      >
                        <X className="size-[15px]" aria-hidden="true" />
                      </button>
                    </div>
                    {s.kind === "email" && (
                      <>
                        <Input
                          value={s.subject ?? ""}
                          aria-label="Subject"
                          placeholder={
                            i === 0 ? "Subject" : "Subject (empty answers the first email)"
                          }
                          className="bg-muted h-10 rounded-full border-0 px-3.5 font-semibold"
                          onChange={(e) => change(s.key, { subject: e.target.value })}
                        />
                        <Textarea
                          value={s.body ?? ""}
                          aria-label="Message"
                          rows={6}
                          className="bg-muted rounded-[20px] border-0 px-3.5 py-2.5 leading-relaxed"
                          onChange={(e) => change(s.key, { body: e.target.value })}
                        />
                        {tells.length > 0 && (
                          <span className="flex flex-nowrap items-center gap-2.5 pt-0.5">
                            {dashes && (
                              <AmbientButton
                                action={{
                                  key: "dashes",
                                  label: "Take out the dashes",
                                  tone: "spark",
                                  reason: "Dashes read as machine-written",
                                  run: async () => {
                                    const fix = (v?: string) =>
                                      (v ?? "").replace(/\s*[—–]\s*/g, ", ");
                                    change(s.key, { subject: fix(s.subject), body: fix(s.body) });
                                    return {};
                                  },
                                }}
                              />
                            )}
                            <AmbientWhy className="min-w-0 truncate">
                              Reads machine-written: {tells.slice(0, 2).join(", ")}
                            </AmbientWhy>
                          </span>
                        )}
                      </>
                    )}
                    {s.kind === "text" && (
                      <>
                        <Textarea
                          value={s.body ?? ""}
                          aria-label="Text message"
                          rows={3}
                          className="bg-muted rounded-[20px] border-0 px-3.5 py-2.5 leading-relaxed"
                          onChange={(e) => change(s.key, { body: e.target.value })}
                        />
                        {textTooLong(s.body) && (
                          <span className="flex flex-nowrap items-center gap-2.5 pt-0.5">
                            <AmbientButton
                              action={{
                                key: "shorten",
                                label: "Shorten",
                                tone: "spark",
                                reason: "Over 160 characters, it would split in two",
                                run: async () => {
                                  change(s.key, { body: shortenText(s.body ?? "") });
                                  return {};
                                },
                              }}
                            />
                            <AmbientWhy className="min-w-0 truncate">
                              Over 160 characters, it would split in two
                            </AmbientWhy>
                          </span>
                        )}
                      </>
                    )}
                    {(s.kind === "task" || s.kind === "call" || s.kind === "linkedin") && (
                      <>
                        <Input
                          value={s.title ?? ""}
                          aria-label="What to do"
                          placeholder={
                            s.kind === "call"
                              ? "Call {{first_name}}"
                              : "What their sender should do"
                          }
                          className="bg-muted h-10 rounded-full border-0 px-3.5"
                          onChange={(e) => change(s.key, { title: e.target.value })}
                        />
                        <span className="text-muted-foreground ps-0.5 text-sm">
                          {s.kind === "call"
                            ? "Their sender gets a call in Today, with what's on the timeline."
                            : "Their sender gets a task, linked to the person."}
                        </span>
                      </>
                    )}
                    {s.kind === "wait" && (
                      <span className="text-muted-foreground ps-0.5 text-sm">
                        {stopOn
                          ? "Then the next step goes only to people who haven't replied."
                          : "Then the next step goes to everyone still in it."}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {adding ? (
              <div className="flex flex-wrap items-center gap-2 ps-[50px]">
                {ADD_KINDS.map((k) => (
                  <Button
                    key={k.kind}
                    variant="outline"
                    onClick={() => {
                      setSteps((list) => [...list, newStep(k.kind)]);
                      setDirty(true);
                      setAdding(false);
                    }}
                  >
                    {k.label}
                  </Button>
                ))}
              </div>
            ) : (
              <div className="ps-[50px]">
                <Button variant="outline" onClick={() => setAdding(true)}>
                  <Plus className="size-4" aria-hidden="true" />
                  Add a step
                </Button>
              </div>
            )}
          </div>
        );
      }}
    </CrmCard>
  );
}

// ---------------------------------------------------------------- a campaign

const TARGET_WORDS: Record<string, string> = {
  TODO: "To reach",
  CONTACTED: "Reached",
  REPLIED: "Replied",
  BOOKED: "Booked",
  CONVERTED: "Converted",
  SKIPPED: "Skipped",
};

function CampaignPlan({ orgId, data }: { orgId: string; data: CampaignPlanData }) {
  const router = useRouter();
  const { close, hrefFor } = useCrmOpen();
  const [whose, setWhose] = useState<"mine" | "all">(
    data.who.rows.some((r) => r.assigneeId === data.userId) ? "mine" : "all",
  );
  const [writing, setWriting] = useState(false);
  const bulk = data.shape === "email";
  const names = new Map(data.members.map((m) => [m.id, m.name]));
  const todoMine = data.who.rows.filter(
    (r) => r.assigneeId === data.userId && r.status === "TODO" && !r.blocked,
  );
  const shown =
    whose === "mine" ? data.who.rows.filter((r) => r.assigneeId === data.userId) : data.who.rows;
  const running = data.status === "running";

  const share: AmbientAction | null =
    running && !bulk && todoMine.length > 0
      ? data.channel === "sequence"
        ? {
            key: "share",
            label: `Start for my ${todoMine.length}`,
            tone: "solid",
            reason: `${todoMine.length} of yours not reached yet`,
            run: () => enrollShareAction(orgId, data.id),
            done: "Started for your share",
          }
        : data.message
          ? {
              key: "share",
              label: `Write to my ${todoMine.length}`,
              tone: "solid",
              reason: `${todoMine.length} of yours not reached yet`,
              run: async () => {
                setWriting(true);
                return {};
              },
            }
          : null
      : null;
  const fresh: AmbientAction | null =
    running && data.who.newOnList > 0
      ? {
          key: "fresh",
          label: `Add the ${data.who.newOnList} new`,
          tone: "outline",
          reason: `${data.who.newOnList} new on the list since it started`,
          run: () => refreshCampaignAction(orgId, data.id),
          done: "Added and split",
        }
      : null;
  const ambient = [share, fresh].filter((a): a is AmbientAction => Boolean(a));

  const setStatus = async (status: "ACTIVE" | "DONE" | "ARCHIVED", done: string) => {
    const r = await runAction(() => setCampaignStatusAction(orgId, data.id, status));
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    toast({ title: done });
    if (status === "ARCHIVED") close();
    router.refresh();
  };

  return (
    <CrmCard
      title={data.name}
      subtitle={[
        `${data.who.count.toLocaleString("en-US")} ${data.who.count === 1 ? "person" : "people"}`,
        bulk
          ? "one email from the organization"
          : `split among ${Math.max(1, data.who.byMember.filter((m) => m.name !== "Nobody").length)}`,
      ].join(", ")}
      avatar={<PlanMark />}
      description={`${data.name}: steps, who, results and settings`}
      menu={
        <DropdownMenuItem onSelect={() => setStatus("ARCHIVED", "Archived")}>
          <Trash2 className="size-4" aria-hidden="true" />
          Archive this plan
        </DropdownMenuItem>
      }
      menuLabel="More: archive"
      tabs={[
        { value: "steps", label: "Steps" },
        { value: "who", label: "Who", count: todoMine.length || undefined },
        { value: "results", label: "Results" },
        { value: "settings", label: "Settings" },
      ]}
      defaultTab={todoMine.length && running ? "who" : "steps"}
      foot={
        <StatusFoot status={data.status} text={data.statusText}>
          {!bulk &&
            (running ? (
              <Button variant="outline" onClick={() => setStatus("DONE", "Marked done")}>
                Mark done
              </Button>
            ) : (
              <Button onClick={() => setStatus("ACTIVE", "Running again")}>Run again</Button>
            ))}
        </StatusFoot>
      }
    >
      {(t) => {
        if (t === "who") {
          return (
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap items-center gap-2 text-[15px]">
                <span>
                  {data.who.listName
                    ? `Everyone on "${data.who.listName}"`
                    : "Everyone it started with"}
                </span>
                {data.who.chips.map((c) => (
                  <span
                    key={`${c.key}-${c.value}`}
                    className="bg-muted inline-flex h-9 items-center rounded-full px-3.5 text-sm font-semibold"
                  >
                    {c.label}
                  </span>
                ))}
              </div>
              {ambient.length > 0 && (
                <span className="flex flex-wrap items-center gap-2">
                  {ambient.map((a) => (
                    <AmbientButton key={a.key} action={a} />
                  ))}
                  <AmbientWhy className="min-w-0">{ambient[0]!.reason}</AmbientWhy>
                </span>
              )}
              {data.who.byMember.length > 1 && (
                <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  {data.who.byMember.map((m) => (
                    <li key={m.name} className="flex items-baseline gap-2">
                      <b className="min-w-0 flex-1 truncate">{m.name}</b>
                      <span className="text-muted-foreground tabular-nums">
                        {m.contacted} of {m.total} reached, {m.replied} replied
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {!bulk && (
                <Segmented
                  label="Whose"
                  value={whose}
                  onSelect={(v) => setWhose(v as "mine" | "all")}
                  className="self-start"
                  options={[
                    {
                      value: "mine",
                      label: "Mine",
                      count: data.who.rows.filter((r) => r.assigneeId === data.userId).length,
                    },
                    { value: "all", label: "Everyone", count: data.who.rows.length },
                  ]}
                />
              )}
              <div className="flex flex-col">
                {shown.length === 0 && (
                  <p className="text-muted-foreground text-sm">Nobody here.</p>
                )}
                {shown.slice(0, 200).map((r) => (
                  <div
                    key={r.id}
                    className="border-border/60 flex flex-wrap items-center gap-2.5 border-t py-2.5 text-[15px]"
                  >
                    <span className="min-w-0 flex-1">
                      <a
                        href={hrefFor({ kind: "person", id: r.personId })}
                        className="font-semibold hover:underline"
                      >
                        {r.name}
                      </a>
                      {(r.sub || r.blocked) && (
                        <span className="text-muted-foreground block truncate text-[13px]">
                          {[r.blocked, r.sub].filter(Boolean).join(". ")}
                        </span>
                      )}
                    </span>
                    {whose === "all" && !bulk && (
                      <span className="text-muted-foreground text-[13px]">
                        {r.assigneeId ? (names.get(r.assigneeId) ?? "A former member") : "Nobody"}
                      </span>
                    )}
                    <span className="bg-muted rounded-full px-2.5 py-0.5 text-xs font-semibold">
                      {TARGET_WORDS[r.status] ?? r.status}
                    </span>
                    {!bulk && r.status === "TODO" && (
                      <AmbientButton
                        action={{
                          key: "skip",
                          label: "Skip",
                          tone: "outline",
                          reason: "Not reaching them this time",
                          run: () => setTargetStatusAction(orgId, r.id, "SKIPPED"),
                        }}
                      />
                    )}
                  </div>
                ))}
              </div>
              {writing && data.message && (
                <ShareSender
                  orgId={orgId}
                  campaignId={data.id}
                  targets={todoMine}
                  message={data.message}
                  onClose={() => setWriting(false)}
                  onDone={() => {
                    setWriting(false);
                    router.refresh();
                  }}
                />
              )}
            </div>
          );
        }
        if (t === "results") {
          return (
            <div className="flex flex-col gap-6">
              <div className="space-y-3.5">
                <Bars bars={data.results.bars} />
                {data.results.since && (
                  <span className="text-muted-foreground block text-[13px]">
                    Since {data.results.since}.
                  </span>
                )}
              </div>
              <Replies replies={data.results.replies} />
            </div>
          );
        }
        if (t === "settings") {
          return (
            <div className="flex flex-col">
              <Row label="Goal">
                <span className="text-muted-foreground text-sm">{data.goal ?? "None set"}</span>
              </Row>
              <Row label="Due">
                <span className="text-muted-foreground text-sm">{data.due ?? "No date"}</span>
              </Row>
              <Row label="Send from">
                <span className="text-muted-foreground text-sm">
                  {bulk ? "The organization's own address" : "Each member's own mailbox"}
                </span>
              </Row>
              {!bulk && (
                <Row label="Split among">
                  <span className="text-muted-foreground text-sm">
                    {data.who.byMember.map((m) => m.name).join(", ") || "Nobody yet"}
                  </span>
                </Row>
              )}
            </div>
          );
        }
        return (
          <div className="flex flex-col gap-1">
            {data.steps.map((s, i) => (
              <div key={i} className="flex gap-3.5">
                <div className="flex shrink-0 flex-col items-center">
                  <StepMark kind={s.kind} />
                  <span
                    className={cn(
                      "min-h-3.5 w-0.5 flex-1",
                      i === data.steps.length - 1 ? "bg-transparent" : "bg-border",
                    )}
                  />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5 pb-4">
                  <b className="flex min-h-9 items-center text-[15px]">{s.title}</b>
                  {s.subject && (
                    <div className="bg-muted rounded-full px-3.5 py-2 text-sm font-semibold">
                      {s.subject}
                    </div>
                  )}
                  {s.body && (
                    <div className="bg-muted line-clamp-[8] rounded-[20px] px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
                      {s.body}
                    </div>
                  )}
                  {s.note && <span className="text-muted-foreground text-sm">{s.note}</span>}
                </div>
              </div>
            ))}
            {data.sequenceId && (
              <span className="flex flex-nowrap items-center gap-2.5 ps-[50px]">
                <AmbientButton
                  action={{
                    key: "steps",
                    label: "Open its steps",
                    tone: "outline",
                    reason: "Its steps are their own plan",
                    href: hrefFor({ kind: "plan", type: "sequence", id: data.sequenceId }),
                  }}
                />
                <AmbientWhy>Its steps are their own plan</AmbientWhy>
              </span>
            )}
            <p className="text-muted-foreground ps-[50px] pt-1 text-[13px]">
              {bulk
                ? "Sent once; it can't change now."
                : "Set when it started. Each member's message can be edited before it goes."}
            </p>
          </div>
        );
      }}
    </CrmCard>
  );
}
