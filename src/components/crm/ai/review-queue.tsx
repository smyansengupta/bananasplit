"use client";

import { Check, ExternalLink, Inbox, Pencil, Sparkles, Undo2, X } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  acceptAllAction,
  acceptSuggestionAction,
  rejectAllAction,
  rejectSuggestionAction,
  undoSuggestionAction,
} from "@/app/app/[orgSlug]/crm/ai-actions";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { chipClass, Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { crmRecordHref } from "@/lib/crm/href";
import { KIND_LABELS, SOURCE_LABELS, type Citation, type DiffRow, type QueueKind, type SuggestionSource, type TargetKind } from "@/lib/crm/suggestions";
import { cn } from "@/lib/utils";

/**
 * The review queue (docs/features/crm.md, differentiator 6): every change
 * AI, an automation, a connected app or an email proposes, as a before and
 * after with where it came from, accepted or rejected in one click, or all
 * at once. A draft or a task can be edited before it's accepted; anything
 * accepted can be undone from Done.
 */

export interface QueueItemView {
  id: string;
  kind: QueueKind;
  source: SuggestionSource;
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "EXPIRED";
  title: string;
  summary: string | null;
  rows: DiffRow[];
  target: { kind: TargetKind; id: string; name: string } | null;
  citation: Citation | null;
  assignee: string | null;
  proposedBy: string | null;
  reviewedBy: string | null;
  at: string;
  undoable: boolean;
  /** Drafts and tasks: what can be edited before accepting. */
  edit: { subject?: string; body?: string; title?: string; dueDate?: string | null } | null;
}

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ReviewQueue({
  orgId,
  orgSlug,
  items,
  status,
  mine,
  counts,
}: {
  orgId: string;
  orgSlug: string;
  items: QueueItemView[];
  status: "waiting" | "done";
  mine: boolean;
  counts: { waiting: number; mine: number };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [kind, setKind] = useState<QueueKind | "all">("all");
  const base = `/app/${orgSlug}/crm/queue`;
  const shown = useMemo(() => (kind === "all" ? items : items.filter((i) => i.kind === kind)), [items, kind]);
  const kinds = useMemo(() => [...new Set(items.map((i) => i.kind))], [items]);

  const act = async (id: string, fn: () => Promise<{ ok: boolean; error?: string }>, done: string, undo?: () => Promise<unknown>) => {
    setBusy(id);
    const r = await fn().catch(() => null);
    setBusy(null);
    if (!r || !r.ok) {
      toast({ title: r && "error" in r && r.error ? r.error : "That didn't work.", tone: "error" });
      return;
    }
    toast({
      title: done,
      action: undo
        ? {
            label: "Undo",
            run: async () => {
              await undo();
              router.refresh();
            },
          }
        : undefined,
    });
    router.refresh();
  };

  const acceptAll = async () => {
    const ids = shown.map((i) => i.id);
    if (ids.length === 0) return;
    setBusy("all");
    const r = await acceptAllAction(orgId, ids).catch(() => null);
    setBusy(null);
    if (!r || !r.ok) {
      toast({ title: r && !r.ok ? r.error : "That didn't work.", tone: "error" });
      return;
    }
    toast({
      title: `Accepted ${r.accepted.length}.`,
      description: r.failed.length ? `${r.failed.length} couldn't be applied: ${r.failed[0]!.error}` : undefined,
      tone: r.failed.length ? "error" : "success",
    });
    router.refresh();
  };

  const rejectAll = async () => {
    const ids = shown.map((i) => i.id);
    if (ids.length === 0) return;
    setBusy("all");
    const r = await rejectAllAction(orgId, ids).catch(() => null);
    setBusy(null);
    if (!r || !r.ok) {
      toast({ title: r && !r.ok ? r.error : "That didn't work.", tone: "error" });
      return;
    }
    toast({ title: `Rejected ${r.rejected}.` });
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="@container/toolbar">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Show"
            value={status}
            options={[
              { value: "waiting", label: "Waiting", href: mine ? `${base}?mine=1` : base, count: counts.waiting },
              { value: "done", label: "Done", href: `${base}?status=done${mine ? "&mine=1" : ""}` },
            ]}
          />
          <Link
            href={`${base}?${new URLSearchParams({ ...(status === "done" ? { status: "done" } : {}), ...(mine ? {} : { mine: "1" }) })}`}
            className={chipClass(mine)}
            aria-pressed={mine}
          >
            For me
            {counts.mine > 0 && <span className="tabular-nums opacity-70">{counts.mine}</span>}
          </Link>
          {kinds.length > 1 && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Kind">
              <button type="button" className={cn(chipClass(kind === "all"), "h-8 px-3 text-[13px]")} onClick={() => setKind("all")}>
                All
              </button>
              {kinds.map((k) => (
                <button key={k} type="button" className={cn(chipClass(kind === k), "h-8 px-3 text-[13px]")} onClick={() => setKind(k)}>
                  {KIND_LABELS[k]}
                </button>
              ))}
            </div>
          )}
          {status === "waiting" && shown.length > 1 && (
            <div className="ms-auto flex items-center gap-2">
              <Button variant="ghost" disabled={busy === "all"} onClick={rejectAll}>
                Reject all
              </Button>
              <Button disabled={busy === "all"} onClick={acceptAll}>
                <Check className="size-4" aria-hidden="true" />
                Accept all {shown.length}
              </Button>
            </div>
          )}
        </div>
      </div>

      {shown.length === 0 ? (
        <Card>
          <EmptyState
            icon={Inbox}
            title={status === "waiting" ? "Nothing waiting for review" : "Nothing reviewed yet"}
            description="Changes from AI, connected apps, automations and email land here first, with where each came from."
          />
        </Card>
      ) : (
        <ul className="space-y-3">
          {shown.map((item) => (
            <li key={item.id}>
              <SuggestionCard
                item={item}
                orgSlug={orgSlug}
                busy={busy === item.id || busy === "all"}
                onAccept={(edits) =>
                  act(item.id, () => acceptSuggestionAction(orgId, item.id, edits), "Accepted.", () => undoSuggestionAction(orgId, item.id))
                }
                onReject={() => act(item.id, () => rejectSuggestionAction(orgId, item.id), "Rejected.")}
                onUndo={() => act(item.id, () => undoSuggestionAction(orgId, item.id), "Undone. It waits for review again.")}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SuggestionCard({
  item,
  orgSlug,
  busy,
  onAccept,
  onReject,
  onUndo,
}: {
  item: QueueItemView;
  orgSlug: string;
  busy: boolean;
  onAccept: (edits?: Record<string, unknown>) => void;
  onReject: () => void;
  onUndo: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.edit ?? {});
  const waiting = item.status === "PENDING";
  return (
    <Card className="gap-3 p-5">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
        <span className="bg-tint-accent text-tint-accent-foreground grid size-8 shrink-0 place-items-center rounded-full" aria-hidden="true">
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="font-semibold">{item.title}</p>
          <p className="text-muted-foreground text-[13px]">
            {SOURCE_LABELS[item.source]}
            {item.proposedBy ? `, for ${item.proposedBy}` : ""}, {ago(item.at)}
            {item.target && (
              <>
                {" on "}
                <Link href={crmRecordHref(orgSlug, item.target.kind, item.target.id)} className="text-foreground font-medium hover:underline">
                  {item.target.name}
                </Link>
              </>
            )}
          </p>
        </div>
        <Badge variant="secondary">{KIND_LABELS[item.kind]}</Badge>
        {item.status === "ACCEPTED" && <Badge variant="success">Accepted{item.reviewedBy ? ` by ${item.reviewedBy}` : ""}</Badge>}
        {item.status === "REJECTED" && <Badge variant="outline">Rejected{item.reviewedBy ? ` by ${item.reviewedBy}` : ""}</Badge>}
      </div>

      {item.summary && <p className="text-muted-foreground text-sm">{item.summary}</p>}

      {editing && item.edit ? (
        <div className="space-y-2">
          {"subject" in item.edit && (
            <Input value={draft.subject ?? ""} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} aria-label="Subject" />
          )}
          {"body" in item.edit && (
            <Textarea rows={8} value={draft.body ?? ""} onChange={(e) => setDraft({ ...draft, body: e.target.value })} aria-label="Message" />
          )}
          {"title" in item.edit && (
            <Input value={draft.title ?? ""} onChange={(e) => setDraft({ ...draft, title: e.target.value })} aria-label="Task" />
          )}
          {"dueDate" in item.edit && (
            <Input
              type="date"
              className="max-w-48"
              value={draft.dueDate ?? ""}
              onChange={(e) => setDraft({ ...draft, dueDate: e.target.value || null })}
              aria-label="Due"
            />
          )}
        </div>
      ) : (
        item.rows.length > 0 && (
          <dl className="bg-muted/45 divide-border divide-y rounded-2xl text-sm">
            {item.rows.map((r, i) => (
              <div key={i} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)]">
                <dt className="text-muted-foreground">{r.label}</dt>
                <dd className="min-w-0 whitespace-pre-wrap break-words">
                  {r.before !== null && (
                    <>
                      <span className="text-muted-foreground line-through decoration-1">{r.before || "Empty"}</span>
                      <span className="text-muted-foreground px-1.5" aria-label="becomes">
                        to
                      </span>
                    </>
                  )}
                  <span className="font-medium">{r.after}</span>
                </dd>
              </div>
            ))}
          </dl>
        )
      )}

      {item.citation && (
        <p className="text-muted-foreground flex flex-wrap items-center gap-1 text-[13px]">
          <span>From {item.citation.label}</span>
          {item.citation.url && /^https?:\/\//.test(item.citation.url) && (
            <a href={item.citation.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 hover:underline">
              <ExternalLink className="size-3.5" aria-hidden="true" />
              Open
            </a>
          )}
          {item.citation.quote && <q className="ms-1 italic">{item.citation.quote}</q>}
        </p>
      )}

      {waiting ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy} onClick={() => onAccept(editing ? draft : undefined)}>
            <Check className="size-4" aria-hidden="true" />
            {editing ? "Save and accept" : "Accept"}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onReject}>
            <X className="size-4" aria-hidden="true" />
            Reject
          </Button>
          {item.edit && !editing && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(true)}>
              <Pencil className="size-4" aria-hidden="true" />
              Edit
            </Button>
          )}
        </div>
      ) : (
        item.undoable && (
          <div>
            <Button size="sm" variant="outline" disabled={busy} onClick={onUndo}>
              <Undo2 className="size-4" aria-hidden="true" />
              Undo
            </Button>
          </div>
        )
      )}
    </Card>
  );
}
