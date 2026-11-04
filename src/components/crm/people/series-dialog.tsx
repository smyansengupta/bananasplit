"use client";

import Link from "next/link";
import { useState } from "react";

import { enrollAction } from "@/app/app/[orgSlug]/crm/outreach/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { chipClass } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toaster";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

/**
 * Add to a follow-up series (docs/features/crm.md, "One list"), from a
 * person's "…" or People's selection bar: pick one of the series that are
 * on, and the people go in from your mailbox, inside its hours. Anyone
 * another member is talking to is held back unless you say add them
 * anyway; after the first email every step waits for a person's OK, as
 * every plan does ("Nothing sends unapproved").
 */
export function SeriesDialog({
  orgId,
  personIds,
  series,
  settingsHref,
  onClose,
  onDone,
}: {
  orgId: string;
  personIds: string[];
  series: readonly { id: string; name: string }[];
  /** CRM settings > Automations, where series are made. */
  settingsHref: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [seq, setSeq] = useState(series[0]?.id ?? "");
  const [skipped, setSkipped] = useState<{ name: string; reason: string }[] | null>(null);
  const [pending, setPending] = useState(false);
  const many = personIds.length;

  const go = async (confirm: boolean) => {
    setPending(true);
    const r = await runAction(() => enrollAction(orgId, seq, personIds, confirm));
    setPending(false);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    const name = series.find((s) => s.id === seq)?.name ?? "the series";
    toast({
      title: r.enrolled ? `Added ${r.enrolled} to ${name}.` : "Nobody was added.",
      tone: r.enrolled ? "success" : "default",
    });
    onDone?.();
    if (r.skipped.length) setSkipped(r.skipped);
    else onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to a follow-up series</DialogTitle>
          <DialogDescription>
            {series.length === 0
              ? "No follow-up series is on yet. Make one, or turn one on, in CRM settings."
              : "The first email goes from your mailbox inside the series' hours. Every one after waits for your OK, and it stops when they reply."}
          </DialogDescription>
        </DialogHeader>
        {series.length === 0 ? (
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button asChild>
              <Link href={settingsHref}>Open Automations</Link>
            </Button>
          </DialogFooter>
        ) : skipped ? (
          <div className="space-y-2 text-sm">
            <p className="font-semibold">Held back</p>
            <ul className="space-y-1">
              {skipped.map((s, i) => (
                <li key={i}>
                  <b>{s.name}</b> <span className="text-muted-foreground">{s.reason}</span>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Done
              </Button>
              {skipped.some((s) => / (has them|emailed|called|met|texted|was in touch)/.test(s.reason)) && (
                <Button disabled={pending} onClick={() => go(true)}>
                  Add them anyway
                </Button>
              )}
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Follow-up series">
              {series.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={seq === s.id}
                  className={cn(chipClass(seq === s.id), "h-8 px-3")}
                  onClick={() => setSeq(s.id)}
                >
                  {s.name}
                </button>
              ))}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={pending || !seq || many === 0} onClick={() => go(false)}>
                {many === 1 ? "Add them" : `Add ${many}`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
