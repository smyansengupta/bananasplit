"use client";

import Link from "next/link";
import { useState } from "react";

import { enrollAction } from "@/app/app/[orgSlug]/crm/outreach/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { chipClass } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toaster";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

/**
 * Add to a follow-up series (docs/features/crm.md, "One list"), from a
 * person's "…" (a panel over their card, SeriesPicker) or People's
 * selection bar (this dialog): pick one of the series that are on, and the
 * people go in from your mailbox, inside its hours. Anyone another member
 * is talking to is held back unless you say add them anyway; after the
 * first email every step waits for a person's OK, as every plan does
 * ("Nothing sends unapproved").
 */

export const SERIES_ABOUT =
  "The first email goes from your mailbox inside the series' hours. Every one after waits for your OK, and it stops when they reply.";
export const SERIES_NONE =
  "No follow-up series is on yet. Make one, or turn one on, in CRM settings.";

interface SeriesProps {
  orgId: string;
  personIds: string[];
  series: readonly { id: string; name: string }[];
  /** CRM settings > Automations, where series are made. */
  settingsHref: string;
  onClose: () => void;
  onDone?: () => void;
}

/** The picker itself: the series as chips, Add, and who was held back. */
export function SeriesPicker({ orgId, personIds, series, settingsHref, onClose, onDone }: SeriesProps) {
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

  const foot = "flex flex-wrap justify-end gap-2 pt-2";
  if (series.length === 0) {
    return (
      <div className={foot}>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button asChild>
          <Link href={settingsHref}>Open Automations</Link>
        </Button>
      </div>
    );
  }
  if (skipped) {
    return (
      <div className="space-y-2 text-sm">
        <p className="font-semibold">Held back</p>
        <ul className="space-y-1">
          {skipped.map((s, i) => (
            <li key={i}>
              <b>{s.name}</b> <span className="text-muted-foreground">{s.reason}</span>
            </li>
          ))}
        </ul>
        <div className={foot}>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
          {skipped.some((s) => / (has them|emailed|called|met|texted|was in touch)/.test(s.reason)) && (
            <Button disabled={pending} onClick={() => go(true)}>
              Add them anyway
            </Button>
          )}
        </div>
      </div>
    );
  }
  return (
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
      <div className={foot}>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={pending || !seq || many === 0} onClick={() => go(false)}>
          {many === 1 ? "Add them" : `Add ${many}`}
        </Button>
      </div>
    </div>
  );
}

/** People's selection bar: the picker in a dialog of its own (no card under it). */
export function SeriesDialog(props: SeriesProps) {
  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to a follow-up series</DialogTitle>
          <DialogDescription>{props.series.length === 0 ? SERIES_NONE : SERIES_ABOUT}</DialogDescription>
        </DialogHeader>
        <SeriesPicker {...props} />
      </DialogContent>
    </Dialog>
  );
}
