"use client";

import { Mail, Users } from "@/components/icons";
import Link from "next/link";
import { useState } from "react";

import { createCampaignAction } from "@/app/app/[orgSlug]/crm/outreach/actions";
import { CrmCard } from "@/components/crm/card/crm-card";
import { useCrmOpen } from "@/components/crm/card/use-crm-open";
import { BulkComposer } from "@/components/crm/outreach/bulk";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { chipClass } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toaster";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

/**
 * A new plan that isn't steps over days (?open=plan:email or plan:split):
 * one email to everyone on a list (from the organization's own sender), or
 * a list split among members, each reaching their share from their own
 * mailbox. Once made, it opens as its plan card.
 */

type How = "email" | "sequence" | "event" | "form" | "call";

interface Choice {
  id: string;
  name: string;
}

function Chips<T extends string | null>({
  options,
  value,
  onPick,
  label,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onPick: (v: T) => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className={cn(chipClass(o.value === value), "h-9 px-3.5")}
          onClick={() => onPick(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

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
}) {
  if (what === "email") {
    return (
      <CrmCard
        title="One email to a list"
        subtitle="From your organization's own address, each merged for its person"
        avatar={
          <span className="grid size-[52px] shrink-0 place-items-center rounded-full bg-[color-mix(in_oklab,var(--tag-navy)_22%,var(--card))]">
            <Mail className="size-5" aria-hidden="true" />
          </span>
        }
      >
        <BulkComposer
          orgId={orgId}
          orgSlug={orgSlug}
          lists={lists.map((l) => ({ id: l.id, name: l.name, count: l.emailable }))}
          templates={templates}
          sender={
            sender ?? { ok: false, from: null, problem: "We couldn't check your sender just now." }
          }
          canSend={canSend}
        />
      </CrmCard>
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
  const { setOpen } = useCrmOpen();
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [viewId, setViewId] = useState<string | null>(lists[0]?.id ?? null);
  const [how, setHow] = useState<How>("email");
  const [pick, setPick] = useState<string | null>(null);
  const [split, setSplit] = useState<string[]>([userId]);
  const [pending, setPending] = useState(false);

  const create = async () => {
    if (!viewId) return;
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
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    toast({ title: `${r.people} people split among ${split.length}`, tone: "success" });
    setOpen({ kind: "plan", type: "campaign", id: r.id });
  };

  const empty: Record<How, string> = {
    email: "No templates yet.",
    sequence: "No plan with steps is running.",
    event: "No upcoming event with an RSVP page.",
    form: "No published forms.",
    call: "",
  };

  return (
    <CrmCard
      title="Split a list among members"
      subtitle="Each member gets their share in Today and reaches them from their own mailbox"
      avatar={
        <span className="grid size-[52px] shrink-0 place-items-center rounded-full bg-[color-mix(in_oklab,var(--tag-forest)_22%,var(--card))]">
          <Users className="size-5" aria-hidden="true" />
        </span>
      }
      foot={
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground flex-1 text-sm">
            {viewId
              ? `${lists.find((l) => l.id === viewId)?.count ?? 0} people, split among ${split.length}`
              : "Pick who it's for"}
          </span>
          <Button
            disabled={
              pending || !name.trim() || !viewId || split.length === 0 || (how !== "call" && !pick)
            }
            onClick={create}
          >
            Start it
          </Button>
        </div>
      }
    >
      <div className="space-y-5 text-sm">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Reach every donor before the showcase"
          aria-label="Name"
          autoFocus
        />
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Goal (optional)"
            aria-label="Goal"
          />
          <Input
            type="date"
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
            aria-label="Due"
          />
        </div>
        <div className="grid gap-2">
          <b className="text-[15px]">Who</b>
          {lists.length === 0 ? (
            <p className="text-muted-foreground">
              Save a view of people first, on{" "}
              <Link
                href={`/app/${orgSlug}/crm/people`}
                className="text-foreground underline underline-offset-4"
              >
                People
              </Link>
              .
            </p>
          ) : (
            <Chips
              label="Who"
              value={viewId}
              onPick={setViewId}
              options={lists.map((l) => ({ value: l.id, label: `${l.name} (${l.count})` }))}
            />
          )}
        </div>
        <div className="grid gap-2">
          <b className="text-[15px]">How to reach them</b>
          <Chips
            label="How"
            value={how}
            onPick={(v) => {
              setHow(v);
              setPick(null);
            }}
            options={[
              { value: "email", label: "An email" },
              { value: "sequence", label: "A plan with steps" },
              { value: "event", label: "Invite to an event" },
              { value: "form", label: "Invite to a form" },
              { value: "call", label: "Calls" },
            ]}
          />
          {how !== "call" &&
            (choices[how].length === 0 ? (
              <p className="text-muted-foreground">{empty[how]}</p>
            ) : (
              <Chips
                label="Which"
                value={pick}
                onPick={setPick}
                options={choices[how].map((o) => ({ value: o.id, label: o.name }))}
              />
            ))}
        </div>
        <div className="grid gap-2">
          <b className="text-[15px]">Split among</b>
          <div className="flex flex-wrap gap-1.5">
            {members.map((m) => (
              <button
                key={m.id}
                type="button"
                className={cn(chipClass(split.includes(m.id)), "h-9 px-3.5")}
                onClick={() =>
                  setSplit(
                    split.includes(m.id) ? split.filter((x) => x !== m.id) : [...split, m.id],
                  )
                }
              >
                {m.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </CrmCard>
  );
}
