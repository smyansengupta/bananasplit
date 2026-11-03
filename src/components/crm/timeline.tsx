"use client";

import {
  Activity,
  CalendarCheck,
  CalendarDays,
  CheckSquare,
  ClipboardList,
  Columns3,
  Mail,
  MessageSquare,
  NotebookText,
  Phone,
  Sparkles,
  Ticket,
  Wallet,
  type IconComponent,
} from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { loadTimelineAction, logActivityAction } from "@/app/app/[orgSlug]/crm/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { chipClass } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { crmRecordHref } from "@/lib/crm/href";
import { cn } from "@/lib/utils";

/**
 * A record's timeline (docs/features/crm.md, module 3): what was logged by
 * hand and everything that came in from the workspace (meetings, RSVPs,
 * check-ins, form answers, linked tasks, payments, stage moves), newest
 * first. Log a note, a call, an email or a meeting in one step at the top.
 */

export interface TimelineItem {
  id: string;
  kind: string;
  subject: string | null;
  body: string | null;
  occurredAt: string;
  actorId: string | null;
  sourceKind: string | null;
  targets: { kind: "person" | "company" | "deal"; id: string; label?: string }[];
}

const ICONS: Record<string, IconComponent> = {
  EMAIL: Mail,
  MEETING: CalendarDays,
  CALL: Phone,
  TEXT: MessageSquare,
  NOTE: NotebookText,
  TASK: CheckSquare,
  FORM_RESPONSE: ClipboardList,
  RSVP: Ticket,
  CHECK_IN: CalendarCheck,
  PAYMENT: Wallet,
  STAGE_CHANGE: Columns3,
  FIELD_CHANGE: Activity,
  SEQUENCE_STEP: Mail,
  SYSTEM: Sparkles,
};

const WORDS: Record<string, string> = {
  EMAIL: "Email",
  MEETING: "Meeting",
  CALL: "Call",
  TEXT: "Text",
  NOTE: "Note",
  TASK: "Task",
  FORM_RESPONSE: "Form",
  RSVP: "RSVP",
  CHECK_IN: "Check-in",
  PAYMENT: "Payment",
  STAGE_CHANGE: "Stage",
  SYSTEM: "Update",
};

const LOG_KINDS = ["NOTE", "CALL", "EMAIL", "MEETING"] as const;

function when(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days < 0) return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (days === 0) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (days < 7) return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: days > 300 ? "numeric" : undefined });
}

export function Timeline({
  orgId,
  orgSlug,
  target,
  initial,
  members,
  /** Also log it on these (the item's company and people). */
  alsoOn = [],
}: {
  orgId: string;
  orgSlug: string;
  target: { kind: "person" | "company" | "deal"; id: string };
  initial: TimelineItem[];
  members: Record<string, string>;
  alsoOn?: { kind: "person" | "company" | "deal"; id: string }[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [kind, setKind] = useState<(typeof LOG_KINDS)[number]>("NOTE");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [more, setMore] = useState(initial.length >= 50);
  const [open, setOpen] = useState<string | null>(null);

  // A refresh brings new server data: show it.
  const [shown, setShown] = useState(initial);
  if (shown !== initial) {
    setShown(initial);
    setItems(initial);
    setMore(initial.length >= 50);
  }

  return (
    <div className="space-y-4">
      <form
        className="bg-card ring-foreground/6 rounded-card space-y-2.5 p-4 ring-1"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          const r = await logActivityAction(orgId, {
            kind,
            subject: subject || undefined,
            body: body || undefined,
            targets: [target, ...alsoOn],
          }).catch(() => null);
          setPending(false);
          if (!r || !r.ok) {
            toast({ title: r && !r.ok ? r.error : "That didn't save.", tone: "error" });
            return;
          }
          setItems((cur) => [
            {
              id: r.id,
              kind,
              subject: subject || null,
              body: body || null,
              occurredAt: new Date().toISOString(),
              actorId: null,
              sourceKind: null,
              targets: [],
            },
            ...cur,
          ]);
          setSubject("");
          setBody("");
          router.refresh();
        }}
      >
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="What happened">
          {LOG_KINDS.map((k) => {
            const Icon = ICONS[k]!;
            return (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={cn(chipClass(kind === k), "h-8 px-3 text-[13px]")}>
                <Icon className="size-3.5" aria-hidden="true" />
                {WORDS[k]}
              </button>
            );
          })}
        </div>
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={kind === "NOTE" ? "Title (optional)" : "What it was about"} aria-label="Subject" />
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="What was said, what's next" aria-label="Details" />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={pending || (!subject.trim() && !body.trim())}>
            {pending ? "Saving…" : `Log ${WORDS[kind]!.toLowerCase()}`}
          </Button>
        </div>
      </form>

      {items.length === 0 ? (
        <p className="text-muted-foreground px-1 text-sm">
          Nothing yet. Meetings, RSVPs, check-ins and form answers show up here by themselves.
        </p>
      ) : (
        <ol className="relative space-y-1">
          {items.map((it) => {
            const Icon = ICONS[it.kind] ?? Activity;
            const expanded = open === it.id;
            return (
              <li key={it.id} className="flex gap-3 rounded-xl px-1 py-2">
                <span className="bg-muted text-muted-foreground grid size-8 shrink-0 place-items-center rounded-full">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <b className="text-sm">{it.subject ?? WORDS[it.kind] ?? "Activity"}</b>
                    <span className="text-muted-foreground text-xs">
                      {[it.subject ? WORDS[it.kind] : null, it.actorId ? members[it.actorId] : null]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                    <span className="text-muted-foreground ms-auto text-xs tabular-nums">{when(it.occurredAt)}</span>
                  </div>
                  {it.body && (
                    <button type="button" onClick={() => setOpen(expanded ? null : it.id)} className="text-muted-foreground mt-0.5 block w-full text-left text-sm">
                      <span className={cn("whitespace-pre-wrap", !expanded && "line-clamp-2")}>{it.body}</span>
                    </button>
                  )}
                  {it.targets.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                      {it.targets.slice(0, 4).map((t) =>
                        t.label ? (
                          <Link key={`${t.kind}:${t.id}`} href={crmRecordHref(orgSlug, t.kind, t.id)} className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">
                            {t.label}
                          </Link>
                        ) : null,
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {more && items.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            const last = items[items.length - 1]!;
            const r = await loadTimelineAction(orgId, target, last.occurredAt).catch(() => null);
            if (!r || !r.ok) return;
            setItems((cur) => [
              ...cur,
              ...r.entries.map((e) => ({
                id: e.id,
                kind: e.kind,
                subject: e.subject,
                body: e.body,
                occurredAt: new Date(e.occurredAt).toISOString(),
                actorId: e.actorId,
                sourceKind: e.sourceKind,
                targets: e.targets,
              })),
            ]);
            if (r.entries.length < 50) setMore(false);
          }}
        >
          Older
        </Button>
      )}
    </div>
  );
}
