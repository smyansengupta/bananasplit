"use client";

import { CalendarClock, Copy, ExternalLink, Plus, Trash2 } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createBookingPageAction, saveBookingPageAction } from "@/app/app/[orgSlug]/crm/outreach/actions";
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
import type { BookingQuestion } from "@/lib/crm/outreach/booking";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

/**
 * Booking pages: a link anyone can book a time on, built on the hosts'
 * availability and calendars. Several hosts take turns.
 */

export interface BookingRow {
  id: string;
  title: string;
  url: string;
  active: boolean;
  hosts: string[];
  durationMin: number;
  booked: number;
}

export function BookingList({ orgId, orgSlug, pages }: { orgId: string; orgSlug: string; pages: BookingRow[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const create = async () => {
    const r = await runAction(() => createBookingPageAction(orgId, title));
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    router.push(`/app/${orgSlug}/crm/outreach/booking/${r.id}`);
  };
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="create" onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden="true" />
          New booking page
        </Button>
      </div>
      {pages.length === 0 ? (
        <EmptyState icon={CalendarClock} title="No booking pages yet" description="Share one link and people pick a time you're free. It lands in Meetings and on their timeline." />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {pages.map((p) => (
            <li key={p.id} className="bg-card ring-foreground/6 rounded-card flex flex-col gap-2 p-4 ring-1">
              <div className="flex items-center gap-2">
                <Link href={`/app/${orgSlug}/crm/outreach/booking/${p.id}`} className="heading min-w-0 flex-1 truncate text-[15px] hover:underline">
                  {p.title}
                </Link>
                <Badge variant={p.active ? "success" : "secondary"}>{p.active ? "Open" : "Off"}</Badge>
              </div>
              <p className="text-muted-foreground text-sm">
                {p.durationMin} minutes with {p.hosts.join(", ") || "nobody yet"}
                {p.hosts.length > 1 ? ", taking turns" : ""}. {p.booked} booked.
              </p>
              <CopyLink url={p.url} />
            </li>
          ))}
        </ul>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New booking page</DialogTitle>
            <DialogDescription>Thirty minutes with you, on weekdays 9 to 5, unless you change it.</DialogDescription>
          </DialogHeader>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Coffee chat" autoFocus maxLength={120} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button disabled={!title.trim()} onClick={create}>
              Make it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function CopyLink({ url, label }: { url: string; label?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <code className="bg-muted min-w-0 flex-1 truncate rounded-lg px-2 py-1 text-xs">{url}</code>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={label ?? "Copy the link"}
        title="Copy"
        onClick={async () => {
          await navigator.clipboard.writeText(url).catch(() => undefined);
          toast({ title: "Copied" });
        }}
      >
        <Copy className="size-4" aria-hidden="true" />
      </Button>
      <Button asChild variant="ghost" size="icon-sm" title="Open">
        <a href={url} target="_blank" rel="noreferrer" aria-label="Open">
          <ExternalLink className="size-4" aria-hidden="true" />
        </a>
      </Button>
    </div>
  );
}

export interface BookingPageState {
  id: string;
  title: string;
  description: string;
  slug: string;
  url: string;
  durationMin: number;
  bufferMin: number;
  minNoticeHours: number;
  maxDaysAhead: number;
  hostIds: string[];
  questions: BookingQuestion[];
  pipelineId: string | null;
  active: boolean;
}

const DURATIONS = [15, 20, 30, 45, 60, 90];

export function BookingEditor({
  orgId,
  page,
  members,
  pipelines,
}: {
  orgId: string;
  page: BookingPageState;
  members: { id: string; name: string }[];
  pipelines: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [s, setS] = useState(page);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const set = (patch: Partial<BookingPageState>) => {
    setS((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  const save = async () => {
    setPending(true);
    const r = await runAction(() =>
      saveBookingPageAction(orgId, page.id, {
        title: s.title,
        description: s.description,
        slug: s.slug,
        durationMin: s.durationMin,
        bufferMin: s.bufferMin,
        minNoticeHours: s.minNoticeHours,
        maxDaysAhead: s.maxDaysAhead,
        hostIds: s.hostIds,
        questions: s.questions,
        pipelineId: s.pipelineId,
        active: s.active,
      }),
    );
    setPending(false);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    setDirty(false);
    toast({ title: "Saved", tone: "success" });
    router.refresh();
  };
  return (
    <div className="grid max-w-4xl gap-5 lg:grid-cols-2">
      <section className="bg-card ring-foreground/6 rounded-card space-y-3 p-5 ring-1">
        <label className="grid gap-1.5 text-sm">
          <span className="text-muted-foreground">Title</span>
          <Input value={s.title} onChange={(e) => set({ title: e.target.value })} maxLength={120} />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="text-muted-foreground">What it&apos;s for</span>
          <Textarea value={s.description} onChange={(e) => set({ description: e.target.value })} rows={3} />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="text-muted-foreground">Link</span>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground text-sm">/book/</span>
            <Input value={s.slug} onChange={(e) => set({ slug: e.target.value.toLowerCase() })} maxLength={48} />
          </div>
        </label>
        <CopyLink url={page.url} />
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="bp-active">Taking bookings</Label>
          <Switch id="bp-active" checked={s.active} onCheckedChange={(v) => set({ active: v })} />
        </div>
      </section>
      <section className="bg-card ring-foreground/6 rounded-card space-y-4 p-5 ring-1">
        <div className="grid gap-1.5 text-sm">
          <span className="text-muted-foreground">How long</span>
          <div className="flex flex-wrap gap-1.5">
            {DURATIONS.map((d) => (
              <button key={d} type="button" className={cn(chipClass(s.durationMin === d), "h-8 px-3")} onClick={() => set({ durationMin: d })}>
                {d} min
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-1.5 text-sm">
          <span className="text-muted-foreground">Hosts {s.hostIds.length > 1 ? "(they take turns)" : ""}</span>
          <div className="flex flex-wrap gap-1.5">
            {members.map((m) => (
              <button
                key={m.id}
                type="button"
                className={cn(chipClass(s.hostIds.includes(m.id)), "h-8 px-3")}
                onClick={() => set({ hostIds: s.hostIds.includes(m.id) ? s.hostIds.filter((h) => h !== m.id) : [...s.hostIds, m.id] })}
              >
                {m.name}
              </button>
            ))}
          </div>
          <p className="text-muted-foreground text-xs">Times come from each host&apos;s availability on their profile and the meetings on their calendar.</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <label className="grid gap-1">
            <span className="text-muted-foreground">Gap between</span>
            <Input type="number" min={0} max={60} value={s.bufferMin} onChange={(e) => set({ bufferMin: Number(e.target.value) || 0 })} />
          </label>
          <label className="grid gap-1">
            <span className="text-muted-foreground">Hours notice</span>
            <Input type="number" min={0} max={168} value={s.minNoticeHours} onChange={(e) => set({ minNoticeHours: Number(e.target.value) || 0 })} />
          </label>
          <label className="grid gap-1">
            <span className="text-muted-foreground">Days ahead</span>
            <Input type="number" min={1} max={90} value={s.maxDaysAhead} onChange={(e) => set({ maxDaysAhead: Number(e.target.value) || 1 })} />
          </label>
        </div>
        <div className="grid gap-1.5 text-sm">
          <span className="text-muted-foreground">Also start an item in</span>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={cn(chipClass(!s.pipelineId), "h-8 px-3")} onClick={() => set({ pipelineId: null })}>
              No pipeline
            </button>
            {pipelines.map((p) => (
              <button key={p.id} type="button" className={cn(chipClass(s.pipelineId === p.id), "h-8 px-3")} onClick={() => set({ pipelineId: p.id })}>
                {p.name}
              </button>
            ))}
          </div>
        </div>
      </section>
      <section className="bg-card ring-foreground/6 rounded-card space-y-3 p-5 ring-1 lg:col-span-2">
        <h2 className="heading text-base">What we ask</h2>
        <p className="text-muted-foreground text-sm">Name and email are always asked.</p>
        {s.questions.map((q, i) => (
          <div key={q.id} className="flex items-center gap-2">
            <Input
              value={q.label}
              onChange={(e) => set({ questions: s.questions.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
              aria-label={`Question ${i + 1}`}
            />
            <button
              type="button"
              className={cn(chipClass(q.required), "h-8 shrink-0 px-3")}
              onClick={() => set({ questions: s.questions.map((x, j) => (j === i ? { ...x, required: !x.required } : x)) })}
            >
              Required
            </button>
            <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => set({ questions: s.questions.filter((_, j) => j !== i) })}>
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          disabled={s.questions.length >= 10}
          onClick={() => set({ questions: [...s.questions, { id: `q${Date.now().toString(36)}`, label: "", required: false }] })}
        >
          <Plus className="size-4" aria-hidden="true" />
          Add a question
        </Button>
      </section>
      <div className="flex gap-2 lg:col-span-2">
        <Button disabled={!dirty || pending} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}
