import type { BlockTone } from "@/components/ui/block-card";

/**
 * Up next (redesign guide 9): up to four block cards from your tasks,
 * meetings, events and polls, answering "what needs me?". Pure, so the
 * ordering rules are unit-tested (up-next.test.ts):
 *
 * - Tone by meaning: a task due today or overdue is `alert` (act now); a
 *   vote, a find-a-time or an RSVP waiting on you is `answer`; meetings,
 *   events and later deadlines are `quiet`.
 * - Sorted by urgency (alert, answer, quiet), then by time.
 * - Never two alerts side by side: alerts take every other slot, at most
 *   one more than the other blocks shown, and two at most in four. Alerts
 *   that don't fit are counted on the last alert block shown ("+2 more").
 */

export const UP_NEXT_LIMIT = 4;

/** The kinds a block can be, and what UpNextDismissal.kind accepts. */
export const UP_NEXT_KINDS = ["task", "meeting", "event", "poll", "rsvp"] as const;
export type UpNextKind = (typeof UP_NEXT_KINDS)[number];

export interface UpNextCandidate {
  id: string;
  kind: UpNextKind;
  tone: BlockTone;
  /** When it's due, starts or closes: the tiebreak within a tone. */
  at: Date;
}

const URGENCY: Record<BlockTone, number> = { alert: 0, answer: 1, quiet: 2, goal: 3 };

export function byUrgency(a: UpNextCandidate, b: UpNextCandidate): number {
  return URGENCY[a.tone] - URGENCY[b.tone] || a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id);
}

export interface UpNextSlot<C extends UpNextCandidate> {
  item: C;
  /** On the last alert shown: how many more alerts didn't fit. */
  moreAlerts: number;
}

/** The blocks to show, in order. */
export function arrangeUpNext<C extends UpNextCandidate>(
  candidates: readonly C[],
  limit = UP_NEXT_LIMIT,
): UpNextSlot<C>[] {
  const sorted = [...candidates].sort(byUrgency);
  const alerts = sorted.filter((c) => c.tone === "alert");
  const others = sorted.filter((c) => c.tone !== "alert");
  const alertSlots = Math.min(alerts.length, others.length + 1, Math.ceil(limit / 2));
  const otherSlots = Math.min(others.length, limit - alertSlots);

  const out: UpNextSlot<C>[] = [];
  let a = 0;
  let o = 0;
  // Alerts first and on every other slot while both remain.
  while (out.length < alertSlots + otherSlots) {
    const lastWasAlert = out.length > 0 && out[out.length - 1].item.tone === "alert";
    if (a < alertSlots && !lastWasAlert) out.push({ item: alerts[a++], moreAlerts: 0 });
    else if (o < otherSlots) out.push({ item: others[o++], moreAlerts: 0 });
    else break;
  }
  const hidden = alerts.length - a;
  if (hidden > 0) {
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].item.tone === "alert") {
        out[i] = { ...out[i], moreAlerts: hidden };
        break;
      }
    }
  }
  return out;
}

/** A task's tone from its due date key against today's. */
export function taskTone(dueKey: string | null, todayKey: string): BlockTone {
  return dueKey !== null && dueKey <= todayKey ? "alert" : "quiet";
}
