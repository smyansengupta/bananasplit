"use client";

import { Megaphone, Plus, Repeat, Users } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createCampaignAction, keepInTouchListAction, saveListAction } from "@/app/app/[orgSlug]/crm/outreach/actions";
import { undoAction } from "@/app/app/[orgSlug]/crm/actions";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { chipClass } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toaster";
import { CADENCES } from "@/lib/crm/outreach/schedule";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

/**
 * Lists and campaigns. A list is a saved view of people (whoever matches
 * today); keep in touch with all of them in one step, or start a campaign:
 * the list plus a goal, a due date and how to reach them, split among
 * members, each with their own share.
 */

export interface ListCard {
  id: string;
  name: string;
  count: number;
  emailable: number;
}

export interface CampaignCard {
  id: string;
  name: string;
  goal: string | null;
  dueOn: string | null;
  status: string;
  channel: string;
  total: number;
  contacted: number;
  replied: number;
  booked: number;
  converted: number;
  mine: number;
}

export interface CampaignChoices {
  templates: { id: string; name: string }[];
  sequences: { id: string; name: string }[];
  events: { id: string; name: string }[];
  forms: { id: string; name: string }[];
  members: { id: string; name: string }[];
  relationshipTypes: { value: string; label: string }[];
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
        <button key={String(o.value)} type="button" className={cn(chipClass(o.value === value), "h-8 px-3")} onClick={() => onPick(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ListsAndCampaigns({
  orgId,
  orgSlug,
  userId,
  lists,
  campaigns,
  choices,
}: {
  orgId: string;
  orgSlug: string;
  userId: string;
  lists: ListCard[];
  campaigns: CampaignCard[];
  choices: CampaignChoices;
}) {
  const router = useRouter();
  const [newList, setNewList] = useState(false);
  const [campaignFor, setCampaignFor] = useState<string | null | undefined>(undefined);

  const cadence = async (list: ListCard, days: number | null) => {
    const r = await runAction(() => keepInTouchListAction(orgId, list.id, days));
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    const batchId = r.batchId;
    toast({
      title: days ? `${r.changed} set to ${CADENCES.find((c) => c.days === days)?.label.toLowerCase()}` : `Cadence off for ${r.changed}`,
      action: {
        label: "Undo",
        run: async () => {
          const u = await undoAction(orgId, batchId);
          router.refresh();
          return u.ok ? null : u.error;
        },
      },
    });
    router.refresh();
  };

  const active = campaigns.filter((c) => c.status === "ACTIVE" && c.channel !== "bulk");
  const past = campaigns.filter((c) => !(c.status === "ACTIVE" && c.channel !== "bulk"));
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="heading flex-1 text-lg">Campaigns</h2>
          <Button variant="create" onClick={() => setCampaignFor(null)}>
            <Plus className="size-4" aria-hidden="true" />
            New campaign
          </Button>
        </div>
        {active.length === 0 ? (
          <EmptyState icon={Megaphone} title="No campaigns running" description="Pick a list, a goal and a date, and split it among members. Everyone gets their share in their queue." />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {active.map((c) => (
              <CampaignTile key={c.id} orgSlug={orgSlug} c={c} />
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="heading flex-1 text-lg">Lists</h2>
          <Button variant="outline" onClick={() => setNewList(true)}>
            <Plus className="size-4" aria-hidden="true" />
            New list
          </Button>
        </div>
        {lists.length === 0 ? (
          <EmptyState size="compact" title="No lists yet" description="A list is whoever matches it today: alumni, donors who gave, everyone going cold." />
        ) : (
          <ul className="grid gap-3 md:grid-cols-3">
            {lists.map((l) => (
              <li key={l.id} className="bg-card ring-foreground/6 rounded-card flex flex-col gap-2 p-4 ring-1">
                <p className="heading truncate text-[15px]">{l.name}</p>
                <p className="text-muted-foreground text-sm tabular-nums">
                  {l.count} {l.count === 1 ? "person" : "people"}, {l.emailable} can be emailed
                </p>
                <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                  <Button size="sm" variant="outline" onClick={() => setCampaignFor(l.id)}>
                    <Megaphone className="size-4" aria-hidden="true" />
                    Campaign
                  </Button>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button size="sm" variant="outline">
                        <Repeat className="size-4" aria-hidden="true" />
                        Keep in touch
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="flex w-72 flex-wrap gap-1.5 p-2">
                      {CADENCES.map((c) => (
                        <button key={c.days} type="button" className={cn(chipClass(false), "h-8 px-3")} onClick={() => cadence(l, c.days)}>
                          {c.label}
                        </button>
                      ))}
                      <button type="button" className={cn(chipClass(false), "h-8 px-3")} onClick={() => cadence(l, null)}>
                        Off
                      </button>
                    </PopoverContent>
                  </Popover>
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/app/${orgSlug}/crm/outreach/bulk`}>Email all</Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {past.length > 0 && (
        <section className="space-y-3">
          <h2 className="heading text-lg">Done and bulk sends</h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {past.map((c) => (
              <CampaignTile key={c.id} orgSlug={orgSlug} c={c} />
            ))}
          </ul>
        </section>
      )}
      {newList && <NewListDialog orgId={orgId} types={choices.relationshipTypes} onClose={() => setNewList(false)} onDone={() => router.refresh()} />}
      {campaignFor !== undefined && (
        <NewCampaignDialog
          orgId={orgId}
          orgSlug={orgSlug}
          userId={userId}
          lists={lists}
          viewId={campaignFor}
          choices={choices}
          onClose={() => setCampaignFor(undefined)}
        />
      )}
    </div>
  );
}

function CampaignTile({ orgSlug, c }: { orgSlug: string; c: CampaignCard }) {
  const pct = (n: number) => (c.total ? Math.round((n / c.total) * 100) : 0);
  return (
    <li>
      <Link href={`/app/${orgSlug}/crm/campaigns/${c.id}`} className="bg-card ring-foreground/6 rounded-card hover:ring-foreground/15 flex flex-col gap-2 p-4 ring-1">
        <div className="flex items-center gap-2">
          <p className="heading min-w-0 flex-1 truncate text-[15px]">{c.name}</p>
          {c.mine > 0 && <Badge variant="accent">{c.mine} yours</Badge>}
          <Badge variant={c.status === "ACTIVE" ? "success" : "secondary"}>{c.channel === "bulk" ? "Bulk" : c.status === "ACTIVE" ? "Running" : c.status === "DONE" ? "Done" : "Archived"}</Badge>
        </div>
        {(c.goal || c.dueOn) && (
          <p className="text-muted-foreground truncate text-sm">
            {[c.goal, c.dueOn ? `by ${new Date(c.dueOn).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : null]
              .filter(Boolean)
              .join(", ")}
          </p>
        )}
        <div className="bg-muted flex h-2 overflow-hidden rounded-full" aria-hidden="true">
          <span className="bg-primary/40" style={{ width: `${pct(c.contacted - c.replied)}%` }} />
          <span className="bg-primary" style={{ width: `${pct(c.replied)}%` }} />
        </div>
        <p className="text-sm tabular-nums">
          {c.contacted} of {c.total} reached, {c.replied} replied, {c.booked} booked, {c.converted} converted
        </p>
      </Link>
    </li>
  );
}

function NewListDialog({
  orgId,
  types,
  onClose,
  onDone,
}: {
  orgId: string;
  types: { value: string; label: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState<string | null>(null);
  const [status, setStatus] = useState<"ACTIVE" | "ALUMNI" | "INACTIVE" | "all">("ACTIVE");
  const [owner, setOwner] = useState<string | null>(null);
  const [due, setDue] = useState<"due" | "cold" | "new" | null>(null);
  const save = async () => {
    const r = await runAction(() => saveListAction(orgId, name, { relationship, status, owner, due }));
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    toast({ title: "List made", tone: "success" });
    onDone();
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New list</DialogTitle>
          <DialogDescription>It&apos;s a saved view: whoever matches it today. It also shows on People.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Alumni to catch up with" autoFocus />
          {types.length > 0 && (
            <div className="grid gap-1.5">
              <span className="text-muted-foreground">Relationship</span>
              <Chips label="Relationship" value={relationship} onPick={setRelationship} options={[{ value: null, label: "Any" }, ...types]} />
            </div>
          )}
          <div className="grid gap-1.5">
            <span className="text-muted-foreground">Status</span>
            <Chips
              label="Status"
              value={status}
              onPick={setStatus}
              options={[
                { value: "ACTIVE", label: "Active" },
                { value: "ALUMNI", label: "Alumni" },
                { value: "INACTIVE", label: "Inactive" },
                { value: "all", label: "All" },
              ]}
            />
          </div>
          <div className="grid gap-1.5">
            <span className="text-muted-foreground">Whose</span>
            <Chips
              label="Whose"
              value={owner}
              onPick={setOwner}
              options={[
                { value: null, label: "Anyone's" },
                { value: "me", label: "Mine" },
                { value: "none", label: "No owner" },
              ]}
            />
          </div>
          <div className="grid gap-1.5">
            <span className="text-muted-foreground">Only</span>
            <Chips
              label="Only"
              value={due}
              onPick={setDue}
              options={[
                { value: null, label: "Everyone" },
                { value: "due", label: "Follow-up due" },
                { value: "cold", label: "Going cold" },
                { value: "new", label: "New this week" },
              ]}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!name.trim()} onClick={save}>
            Make the list
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type How = "email" | "sequence" | "event" | "form" | "call";

function NewCampaignDialog({
  orgId,
  orgSlug,
  userId,
  lists,
  viewId: initialView,
  choices,
  onClose,
}: {
  orgId: string;
  orgSlug: string;
  userId: string;
  lists: ListCard[];
  viewId: string | null;
  choices: CampaignChoices;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [viewId, setViewId] = useState<string | null>(initialView ?? lists[0]?.id ?? null);
  const [how, setHow] = useState<How>("email");
  const [pick, setPick] = useState<string | null>(null);
  const [members, setMembers] = useState<string[]>([userId]);
  const [pending, setPending] = useState(false);
  const options: Record<How, { id: string; name: string }[]> = {
    email: choices.templates,
    sequence: choices.sequences,
    event: choices.events,
    form: choices.forms,
    call: [],
  };
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
        memberIds: members,
      }),
    );
    setPending(false);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    toast({ title: `${r.people} people split among ${members.length}`, tone: "success" });
    router.push(`/app/${orgSlug}/crm/campaigns/${r.id}`);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New campaign</DialogTitle>
          <DialogDescription>Each member gets their share in their queue and sends from their own mailbox.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Reach every alumnus before the gala" autoFocus />
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <Input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Goal (optional)" />
            <Input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} aria-label="Due" />
          </div>
          <div className="grid gap-1.5">
            <span className="text-muted-foreground">List</span>
            {lists.length === 0 ? (
              <p className="text-muted-foreground">Make a list first.</p>
            ) : (
              <Chips label="List" value={viewId} onPick={setViewId} options={lists.map((l) => ({ value: l.id, label: `${l.name} (${l.count})` }))} />
            )}
          </div>
          <div className="grid gap-1.5">
            <span className="text-muted-foreground">How to reach them</span>
            <Chips
              label="How"
              value={how}
              onPick={(v) => {
                setHow(v);
                setPick(null);
              }}
              options={[
                { value: "email", label: "An email" },
                { value: "sequence", label: "A sequence" },
                { value: "event", label: "Invite to an event" },
                { value: "form", label: "Invite to a form" },
                { value: "call", label: "Calls" },
              ]}
            />
            {how !== "call" &&
              (options[how].length === 0 ? (
                <p className="text-muted-foreground">
                  {how === "email" ? "No templates yet." : how === "sequence" ? "No sequence is on." : how === "event" ? "No upcoming event with an RSVP page." : "No published forms."}
                </p>
              ) : (
                <Chips label="Which" value={pick} onPick={setPick} options={options[how].map((o) => ({ value: o.id, label: o.name }))} />
              ))}
          </div>
          <div className="grid gap-1.5">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Users className="size-3.5" aria-hidden="true" />
              Split among
            </span>
            <div className="flex flex-wrap gap-1.5">
              {choices.members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={cn(chipClass(members.includes(m.id)), "h-8 px-3")}
                  onClick={() => setMembers(members.includes(m.id) ? members.filter((x) => x !== m.id) : [...members, m.id])}
                >
                  {m.name}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={pending || !name.trim() || !viewId || members.length === 0 || (how !== "call" && !pick)} onClick={create}>
            Start it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
