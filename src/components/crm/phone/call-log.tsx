"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { logCallAction } from "@/app/app/[orgSlug]/crm/phone-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { chipClass } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { CALL_OUTCOMES, formatDuration, parseDuration } from "@/lib/crm/phone";
import { cn } from "@/lib/utils";

/**
 * How a call went, in one step: the outcome as buttons, how long, what was
 * said, and when to follow up. The same form logs a call made from a phone
 * (tel:) and finishes one the softphone or the dialer placed (callId).
 */

export interface CallTarget {
  personId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
  /** A sequence's call step this call does (it closes in the queue). */
  stepId?: string | null;
}

const FOLLOW_UPS = [
  { id: "", label: "No follow-up" },
  { id: "1", label: "Tomorrow" },
  { id: "7", label: "In a week" },
  { id: "14", label: "In two weeks" },
] as const;

export function LogCallForm({
  orgId,
  target,
  callId,
  durationSec,
  defaultOutcome,
  onSaved,
  onCancel,
  submitLabel = "Log call",
  compact = false,
}: {
  orgId: string;
  target: CallTarget;
  callId?: string | null;
  durationSec?: number | null;
  defaultOutcome?: string | null;
  onSaved?: () => void;
  onCancel?: () => void;
  submitLabel?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<string>(defaultOutcome ?? "connected");
  const [duration, setDuration] = useState(durationSec ? formatDuration(durationSec) : "");
  const [notes, setNotes] = useState("");
  const [follow, setFollow] = useState<string>("");
  const [pending, setPending] = useState(false);

  async function save() {
    const sec = duration.trim() ? parseDuration(duration) : null;
    if (duration.trim() && sec === null) {
      toast({ title: "Write how long like 5:30.", tone: "error" });
      return;
    }
    setPending(true);
    const followUpAt = follow ? new Date(Date.now() + Number(follow) * 86_400_000).toISOString() : null;
    const r = await logCallAction(orgId, {
      ...target,
      callId: callId ?? null,
      outcome,
      notes: notes || null,
      durationSec: sec,
      followUpAt: target.personId ? followUpAt : null,
    }).catch(() => null);
    setPending(false);
    if (!r || !r.ok) {
      toast({ title: r && !r.ok ? r.error : "That didn't save.", tone: "error" });
      return;
    }
    toast({ title: "Call logged." });
    setNotes("");
    router.refresh();
    onSaved?.();
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="How it went">
        {CALL_OUTCOMES.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={outcome === o.id}
            onClick={() => setOutcome(o.id)}
            className={cn(chipClass(outcome === o.id), "h-8 px-3 text-[13px]")}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className={cn("grid gap-3", !compact && "sm:grid-cols-[8rem_1fr]")}>
        <div className="grid gap-1.5">
          <Label htmlFor="call-duration">How long</Label>
          <Input
            id="call-duration"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            placeholder="5:30"
            inputMode="numeric"
          />
        </div>
        {target.personId && (
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">Follow up</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Follow up">
              {FOLLOW_UPS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={follow === f.id}
                  onClick={() => setFollow(f.id)}
                  className={cn(chipClass(follow === f.id), "h-8 px-3 text-[13px]")}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={compact ? 2 : 3}
        placeholder="What was said, what's next"
        aria-label="Notes"
      />
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Not now
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** "Log a call" in a window, for a call made from a phone. */
export function LogCallDialog({
  orgId,
  target,
  name,
  open,
  onOpenChange,
  onSaved,
}: {
  orgId: string;
  target: CallTarget;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log a call with {name}</DialogTitle>
          <DialogDescription>It goes on the timeline and counts as being in touch.</DialogDescription>
        </DialogHeader>
        <LogCallForm
          orgId={orgId}
          target={target}
          onSaved={() => {
            onOpenChange(false);
            onSaved?.();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
