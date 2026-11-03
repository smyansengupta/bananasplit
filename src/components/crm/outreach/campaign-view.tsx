"use client";

import { Phone, RotateCcw, Send, Users } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  enrollShareAction,
  previewAction,
  reassignAction,
  rebalanceAction,
  refreshCampaignAction,
  sendShareAction,
  setCampaignStatusAction,
  setTargetStatusAction,
} from "@/app/app/[orgSlug]/crm/outreach/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Segmented, chipClass } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

import { LogDialog } from "./queue";

/**
 * One campaign: its numbers (contacted, replied, booked, converted), each
 * member's share, and yours to work: preview every message, edit any one
 * for its person, send them from your mailbox; or start the sequence for
 * your share; or call down the list. Anyone can move people between
 * members, or split what's left evenly again.
 */

export interface TargetRow {
  id: string;
  personId: string;
  name: string;
  sub: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  assigneeId: string | null;
  blocked: string | null;
}

const STATUS: Record<string, { label: string; tone: "secondary" | "info" | "success" | "accent" | "outline" }> = {
  TODO: { label: "To reach", tone: "outline" },
  CONTACTED: { label: "Reached", tone: "info" },
  REPLIED: { label: "Replied", tone: "success" },
  BOOKED: { label: "Booked", tone: "success" },
  CONVERTED: { label: "Converted", tone: "accent" },
  SKIPPED: { label: "Skipped", tone: "secondary" },
};

export function CampaignView({
  orgId,
  orgSlug,
  userId,
  campaign,
  numbers,
  byMember,
  rows,
  members,
  message,
}: {
  orgId: string;
  orgSlug: string;
  userId: string;
  campaign: { id: string; name: string; status: string; channel: string; hasList: boolean };
  numbers: { total: number; contacted: number; replied: number; booked: number; converted: number; skipped: number; goalCount: number | null };
  byMember: { userId: string | null; name: string; total: number; contacted: number; replied: number }[];
  rows: TargetRow[];
  members: { id: string; name: string }[];
  message: { subject: string; body: string } | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"mine" | "all">(rows.some((r) => r.assigneeId === userId) ? "mine" : "all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [writing, setWriting] = useState(false);
  const [calling, setCalling] = useState<TargetRow | null>(null);
  const [moving, setMoving] = useState(false);
  const names = new Map(members.map((m) => [m.id, m.name]));
  const shown = tab === "mine" ? rows.filter((r) => r.assigneeId === userId) : rows;
  const todoMine = rows.filter((r) => r.assigneeId === userId && r.status === "TODO" && !r.blocked);
  const isBulk = campaign.channel === "bulk";

  const done = (r: { ok: boolean; error?: string } | undefined, msg: string) => {
    if (!r) return false;
    if (!r.ok) {
      toast({ title: r.error ?? "That didn't work.", tone: "error" });
      return false;
    }
    toast({ title: msg, tone: "success" });
    router.refresh();
    return true;
  };

  const stat = (label: string, n: number) => (
    <div className="bg-card ring-foreground/6 rounded-2xl px-4 py-3 ring-1">
      <dd className="numeral text-[26px] tabular-nums">{n.toLocaleString("en-US")}</dd>
      <dt className="text-muted-foreground text-xs">{label}</dt>
    </div>
  );

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stat(numbers.goalCount ? `People (goal ${numbers.goalCount})` : "People", numbers.total)}
        {stat("Reached", numbers.contacted)}
        {stat("Replied", numbers.replied)}
        {stat("Booked", numbers.booked)}
        {stat("Converted", numbers.converted)}
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        {!isBulk && (
          <>
            {(campaign.channel === "email" || campaign.channel === "event" || campaign.channel.startsWith("form:")) && (
              <Button disabled={todoMine.length === 0 || campaign.status !== "ACTIVE"} onClick={() => setWriting(true)}>
                <Send className="size-4" aria-hidden="true" />
                Write to my {todoMine.length || ""}
              </Button>
            )}
            {campaign.channel === "sequence" && (
              <Button
                disabled={todoMine.length === 0 || campaign.status !== "ACTIVE"}
                onClick={async () => {
                  const r = await runAction(() => enrollShareAction(orgId, campaign.id));
                  if (done(r, r && r.ok ? `${r.enrolled} started` : "")) {
                    if (r && r.ok && r.skipped.length) toast({ title: `${r.skipped.length} held back`, description: r.skipped.slice(0, 3).map((s) => `${s.name}: ${s.reason}`).join(" ") });
                  }
                }}
              >
                <Send className="size-4" aria-hidden="true" />
                Start the sequence for my {todoMine.length || ""}
              </Button>
            )}
            {campaign.hasList && (
              <Button
                variant="outline"
                onClick={async () => {
                  const r = await runAction(() => refreshCampaignAction(orgId, campaign.id));
                  done(r, r && r.ok ? (r.added ? `${r.added} new from the list` : "Nobody new on the list") : "");
                }}
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                Add who's new on the list
              </Button>
            )}
          </>
        )}
        <div className="ms-auto flex gap-2">
          {campaign.status === "ACTIVE" ? (
            <Button variant="outline" onClick={async () => done(await runAction(() => setCampaignStatusAction(orgId, campaign.id, "DONE")), "Marked done")}>
              Mark done
            </Button>
          ) : (
            <Button variant="outline" onClick={async () => done(await runAction(() => setCampaignStatusAction(orgId, campaign.id, "ACTIVE")), "Running again")}>
              Run again
            </Button>
          )}
          <Button variant="ghost" onClick={async () => (await runAction(() => setCampaignStatusAction(orgId, campaign.id, "ARCHIVED")))?.ok && router.push(`/app/${orgSlug}/crm/campaigns`)}>
            Archive
          </Button>
        </div>
      </div>
      {byMember.length > 1 && (
        <section className="bg-card ring-foreground/6 rounded-card space-y-2 p-5 ring-1">
          <h2 className="heading text-base">Who has whom</h2>
          <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {byMember.map((m) => (
              <li key={m.userId ?? "none"} className="flex items-baseline gap-2">
                <b className="min-w-0 flex-1 truncate">{m.name}</b>
                <span className="text-muted-foreground tabular-nums">
                  {m.contacted} of {m.total} reached, {m.replied} replied
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Whose"
            value={tab}
            onSelect={(v) => {
              setTab(v as "mine" | "all");
              setPicked(new Set());
            }}
            options={[
              { value: "mine", label: "Mine", count: rows.filter((r) => r.assigneeId === userId).length },
              { value: "all", label: "Everyone", count: rows.length },
            ]}
          />
          {picked.size > 0 && (
            <Button variant="outline" onClick={() => setMoving(true)}>
              <Users className="size-4" aria-hidden="true" />
              Give {picked.size} to
            </Button>
          )}
          {tab === "all" && picked.size === 0 && !isBulk && (
            <Button variant="ghost" onClick={() => setMoving(true)}>
              Split what's left again
            </Button>
          )}
        </div>
        <ul className="bg-card ring-foreground/6 rounded-card divide-border divide-y ring-1">
          {shown.length === 0 && <li className="text-muted-foreground p-4 text-sm">Nobody here.</li>}
          {shown.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <Checkbox
                checked={picked.has(r.id)}
                onCheckedChange={(v) => {
                  const next = new Set(picked);
                  if (v) next.add(r.id);
                  else next.delete(r.id);
                  setPicked(next);
                }}
                aria-label={`Pick ${r.name}`}
              />
              <div className="min-w-0 flex-1">
                <Link href={`/app/${orgSlug}/crm/people/${r.personId}`} className="font-semibold hover:underline">
                  {r.name}
                </Link>
                <p className="text-muted-foreground truncate text-sm">{[r.sub, r.blocked].filter(Boolean).join(". ")}</p>
              </div>
              {tab === "all" && <span className="text-muted-foreground text-sm">{r.assigneeId ? (names.get(r.assigneeId) ?? "A former member") : "Nobody"}</span>}
              <Badge variant={STATUS[r.status]?.tone ?? "outline"}>{STATUS[r.status]?.label ?? r.status}</Badge>
              {campaign.channel === "call" && r.phone && !r.blocked && (
                <Button asChild variant="ghost" size="icon-sm" title={`Call ${r.phone}`}>
                  <a href={`tel:${r.phone}`} aria-label="Call" onClick={() => setCalling(r)}>
                    <Phone className="size-4" aria-hidden="true" />
                  </a>
                </Button>
              )}
              {r.status === "TODO" ? (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={async () => done(await runAction(() => setTargetStatusAction(orgId, r.id, "SKIPPED")), "Skipped")}
                >
                  Skip
                </Button>
              ) : r.status === "SKIPPED" ? (
                <Button variant="ghost" size="xs" onClick={async () => done(await runAction(() => setTargetStatusAction(orgId, r.id, "TODO")), "Back on the list")}>
                  Put back
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      {writing && message && (
        <ShareSender
          orgId={orgId}
          campaignId={campaign.id}
          targets={todoMine}
          message={message}
          onClose={() => setWriting(false)}
          onDone={() => {
            setWriting(false);
            router.refresh();
          }}
        />
      )}
      {moving && (
        <MoveDialog
          members={members}
          count={picked.size}
          onClose={() => setMoving(false)}
          onPick={async (ids) => {
            const r = picked.size
              ? await runAction(() => reassignAction(orgId, campaign.id, [...picked], ids))
              : await runAction(() => rebalanceAction(orgId, campaign.id, ids));
            if (done(r, "Moved")) {
              setPicked(new Set());
              setMoving(false);
            }
          }}
        />
      )}
      {calling && (
        <LogDialog
          orgId={orgId}
          personId={calling.personId}
          name={calling.name}
          kind="call"
          onClose={() => setCalling(null)}
          onDone={async () => {
            await setTargetStatusAction(orgId, calling.id, "CONTACTED").catch(() => null);
            setCalling(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function MoveDialog({
  members,
  count,
  onClose,
  onPick,
}: {
  members: { id: string; name: string }[];
  count: number;
  onClose: () => void;
  onPick: (ids: string[]) => void;
}) {
  const [ids, setIds] = useState<string[]>([]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{count ? `Give ${count} to` : "Split everyone not reached yet among"}</DialogTitle>
          <DialogDescription>Pick one member, or several to split them evenly.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5">
          {members.map((m) => (
            <button
              key={m.id}
              type="button"
              className={cn(chipClass(ids.includes(m.id)), "h-8 px-3")}
              onClick={() => setIds(ids.includes(m.id) ? ids.filter((x) => x !== m.id) : [...ids, m.id])}
            >
              {m.name}
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={ids.length === 0} onClick={() => onPick(ids)}>
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Every message of your share, previewed and editable one by one, then sent. */
function ShareSender({
  orgId,
  campaignId,
  targets,
  message,
  onClose,
  onDone,
}: {
  orgId: string;
  campaignId: string;
  targets: TargetRow[];
  message: { subject: string; body: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [base, setBase] = useState(message);
  const [rows, setRows] = useState<{ targetId: string; name: string; subject: string; body: string; missing: string[]; edited: boolean }[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const batch = targets.slice(0, 50);

  const preview = async () => {
    setPending(true);
    const r = await runAction(() => previewAction(orgId, base, batch.map((t) => t.personId)));
    setPending(false);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    setRows(
      r.rows
        .filter((p) => !p.blocked)
        .map((p) => ({
          targetId: batch.find((t) => t.personId === p.personId)!.id,
          name: p.name,
          subject: p.subject,
          body: p.body,
          missing: p.missing,
          edited: false,
        })),
    );
  };

  const send = async () => {
    if (!rows) return;
    setPending(true);
    const r = await runAction(() => sendShareAction(orgId, campaignId, rows.map((x) => ({ targetId: x.targetId, subject: x.subject, body: x.body }))));
    setPending(false);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    toast({ title: `${r.queued} on their way${r.skipped.length ? `, ${r.skipped.length} held back` : ""}`, tone: "success", description: r.skipped.slice(0, 3).join(" ") });
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{rows ? `Check each one (${rows.length})` : `Write to your ${batch.length}`}</DialogTitle>
          <DialogDescription>
            {rows ? "Open anyone to change their message. Edits stay theirs." : "Fields fill in for each person. Next you see every message before it goes."}
          </DialogDescription>
        </DialogHeader>
        {!rows ? (
          <div className="space-y-3">
            <Input value={base.subject} onChange={(e) => setBase({ ...base, subject: e.target.value })} aria-label="Subject" />
            <Textarea value={base.body} onChange={(e) => setBase({ ...base, body: e.target.value })} rows={10} aria-label="Message" />
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={pending || !base.subject.trim() || !base.body.trim()} onClick={preview}>
                See each one
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <ul className="max-h-[50dvh] space-y-2 overflow-y-auto">
              {rows.map((x, i) => (
                <li key={x.targetId} className="bg-muted/50 rounded-2xl p-3">
                  <button type="button" className="flex w-full items-center gap-2 text-start" onClick={() => setOpen(open === x.targetId ? null : x.targetId)}>
                    <b className="min-w-0 flex-1 truncate">{x.name}</b>
                    {x.edited && <Badge variant="info">Edited</Badge>}
                    {x.missing.length > 0 && <Badge variant="accent">Missing {x.missing.join(", ")}</Badge>}
                  </button>
                  {open === x.targetId ? (
                    <div className="mt-2 space-y-2">
                      <Input
                        value={x.subject}
                        onChange={(e) => setRows(rows.map((y, j) => (j === i ? { ...y, subject: e.target.value, edited: true } : y)))}
                        aria-label={`Subject for ${x.name}`}
                      />
                      <Textarea
                        value={x.body}
                        rows={7}
                        onChange={(e) => setRows(rows.map((y, j) => (j === i ? { ...y, body: e.target.value, edited: true } : y)))}
                        aria-label={`Message for ${x.name}`}
                      />
                    </div>
                  ) : (
                    <p className="text-muted-foreground mt-1 line-clamp-2 text-sm whitespace-pre-wrap">{x.body}</p>
                  )}
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRows(null)}>
                Back
              </Button>
              <Button disabled={pending || rows.length === 0} onClick={send}>
                <Send className="size-4" aria-hidden="true" />
                Send {rows.length}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
