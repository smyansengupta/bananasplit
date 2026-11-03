"use client";

import { Check, Link2, Plus, Trash2 } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  addDeliverableAction,
  createGuestLinkAction,
  removeDeliverableAction,
  revokeGuestLinkAction,
  setDeliverableDoneAction,
} from "@/app/app/[orgSlug]/crm/outreach/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { chipClass } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toaster";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

import { CopyLink } from "./booking";

/**
 * What we owe them, on a sponsorship or partnership: each promise, its
 * date, done or not (a linked task counts), and the private guest link
 * where the partner sees exactly this and a recap.
 */
export function PartnerPanel({
  orgId,
  dealId,
  deliverables,
  links,
}: {
  orgId: string;
  dealId: string;
  deliverables: { id: string; title: string; dueOn: string | null; done: boolean; taskId: string | null }[];
  links: { id: string; url: string | null; lastViewedAt: string | null }[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [task, setTask] = useState(false);
  const ok = (r: { ok: boolean; error?: string } | undefined, msg?: string) => {
    if (!r) return false;
    if (!r.ok) {
      toast({ title: r.error ?? "That didn't work.", tone: "error" });
      return false;
    }
    if (msg) toast({ title: msg });
    router.refresh();
    return true;
  };
  const live = links.filter((l) => l.url);
  return (
    <div className="space-y-4 text-sm">
      {deliverables.length > 0 && (
        <ul className="space-y-1.5">
          {deliverables.map((d) => (
            <li key={d.id} className="flex items-center gap-2">
              <button
                type="button"
                aria-label={d.done ? `Mark ${d.title} not done` : `Mark ${d.title} done`}
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full",
                  d.done ? "bg-tint-success text-tint-success-foreground" : "ring-foreground/25 ring-1",
                )}
                onClick={async () => ok(await runAction(() => setDeliverableDoneAction(orgId, d.id, !d.done)))}
              >
                {d.done && <Check className="size-3.5" aria-hidden="true" />}
              </button>
              <span className={cn("min-w-0 flex-1 truncate", d.done && "text-muted-foreground line-through")}>{d.title}</span>
              {d.taskId && <span className="text-muted-foreground text-xs">Task</span>}
              {d.dueOn && <span className="text-muted-foreground text-xs">{new Date(d.dueOn).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</span>}
              <Button variant="ghost" size="icon-xs" aria-label={`Remove ${d.title}`} onClick={async () => ok(await runAction(() => removeDeliverableAction(orgId, d.id)))}>
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim()) return;
          if (ok(await runAction(() => addDeliverableAction(orgId, dealId, { title, dueOn: due || null, taskOwnerId: task ? "" : null })), "Added")) {
            setTitle("");
            setDue("");
          }
        }}
      >
        <div className="flex gap-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Logo on the shirts" aria-label="What we owe them" />
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="w-40" aria-label="By" />
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={cn(chipClass(task), "h-8 px-3")} onClick={() => setTask(!task)}>
            Make it a task for me
          </button>
          <Button type="submit" size="sm" variant="outline" disabled={!title.trim()}>
            <Plus className="size-4" aria-hidden="true" />
            Add
          </Button>
        </div>
      </form>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5 border-t pt-3">
        <span className="text-muted-foreground flex items-center gap-1.5">
          <Link2 className="size-3.5" aria-hidden="true" />
          Their private page
        </span>
        {live.map((l) => (
          <div key={l.id} className="min-w-0 space-y-1">
            <CopyLink url={l.url!} label="Copy their link" />
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground flex-1 text-xs">
                {l.lastViewedAt ? `Opened ${new Date(l.lastViewedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Not opened yet"}
              </span>
              <Button variant="ghost" size="xs" onClick={async () => ok(await runAction(() => revokeGuestLinkAction(orgId, l.id)), "Link off")}>
                Turn off
              </Button>
            </div>
          </div>
        ))}
        {live.length === 0 && (
          <Button
            variant="outline"
            size="sm"
            className="justify-self-start"
            onClick={async () => {
              const r = await runAction(() => createGuestLinkAction(orgId, dealId, null));
              if (ok(r) && r?.ok) {
                await navigator.clipboard.writeText(r.url).catch(() => undefined);
                toast({ title: "Link made and copied", description: "They see this agreement, what we owe them and a recap. Nothing else." });
              }
            }}
          >
            Make a link for them
          </Button>
        )}
      </div>
    </div>
  );
}
