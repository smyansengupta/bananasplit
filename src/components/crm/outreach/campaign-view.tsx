"use client";

import { Send } from "@/components/icons";
import { useState } from "react";

import { previewAction, sendShareAction } from "@/app/app/[orgSlug]/crm/outreach/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { runAction } from "@/lib/run-action";

/** A member's share of a campaign: one person on it, as the plan card lists them. */
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

/** Every message of your share, previewed and editable one by one, then sent. */
export function ShareSender({
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
