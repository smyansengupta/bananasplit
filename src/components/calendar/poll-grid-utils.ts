import type { PollAvailability } from "@/generated/prisma/enums";

export interface PollSlotLite {
  id: string;
  startsAt: Date;
  endsAt: Date;
}

/**
 * One answer, keyed by an opaque respondent key (src/lib/polls/poll-view.ts):
 * the grid never sees user ids, and two guests with the same name stay two
 * respondents.
 */
export interface PollResponseLite {
  slotId: string;
  respondentKey: string;
  label?: string;
  isGuest?: boolean;
  availability: PollAvailability;
}

/** "YYYY-MM-DD" in the viewer's local time. */
export function localDayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "HH:mm" in the viewer's local time. */
export function localTimeKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export interface PollGrid {
  days: string[];
  times: string[];
  cellFor: (day: string, time: string) => PollSlotLite | undefined;
}

/** Builds the day x time-of-day matrix used to render the response grid, in the viewer's local time. */
export function buildPollGrid(slots: PollSlotLite[]): PollGrid {
  const days = [...new Set(slots.map((s) => localDayKey(s.startsAt)))].sort();
  const times = [...new Set(slots.map((s) => localTimeKey(s.startsAt)))].sort();
  const byKey = new Map<string, PollSlotLite>();
  for (const slot of slots) {
    byKey.set(`${localDayKey(slot.startsAt)}_${localTimeKey(slot.startsAt)}`, slot);
  }
  return {
    days,
    times,
    cellFor: (day, time) => byKey.get(`${day}_${time}`),
  };
}

function respondentKey(r: PollResponseLite): string {
  return r.respondentKey;
}

/** Every distinct person who has answered at least one slot, for the results table. */
export function distinctRespondents(
  responses: PollResponseLite[],
): { key: string; name: string; isGuest: boolean }[] {
  const seen = new Map<string, { key: string; name: string; isGuest: boolean }>();
  for (const r of responses) {
    const key = respondentKey(r);
    if (!seen.has(key)) {
      seen.set(key, { key, name: r.label ?? "Respondent", isGuest: Boolean(r.isGuest) });
    }
  }
  return [...seen.values()];
}

export interface RankedSlot {
  slot: PollSlotLite;
  score: number;
  respondentKeys: string[];
}

/**
 * Ranks each possible contiguous window of `durationMinutes` by how many
 * distinct respondents are available (YES or IF_NEEDED) across every slot in
 * that window. Windows with a gap in the underlying slots are skipped.
 */
export function rankSlotsByAvailability(
  slots: PollSlotLite[],
  responses: PollResponseLite[],
  durationMinutes: number,
): RankedSlot[] {
  if (slots.length === 0) return [];
  const sorted = [...slots].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const granularityMs = sorted[0].endsAt.getTime() - sorted[0].startsAt.getTime();
  const windowSlotCount = Math.max(1, Math.ceil((durationMinutes * 60_000) / granularityMs));

  const responsesBySlot = new Map<string, PollResponseLite[]>();
  for (const r of responses) {
    const list = responsesBySlot.get(r.slotId) ?? [];
    list.push(r);
    responsesBySlot.set(r.slotId, list);
  }

  const results: RankedSlot[] = [];
  for (let i = 0; i + windowSlotCount <= sorted.length; i++) {
    const window = sorted.slice(i, i + windowSlotCount);
    let contiguous = true;
    for (let j = 1; j < window.length; j++) {
      if (window[j].startsAt.getTime() !== window[j - 1].endsAt.getTime()) {
        contiguous = false;
        break;
      }
    }
    if (!contiguous) continue;

    let available: Set<string> | null = null;
    for (const slot of window) {
      const slotResponses = responsesBySlot.get(slot.id) ?? [];
      const availableHere = new Set(
        slotResponses
          .filter((r) => r.availability === "YES" || r.availability === "IF_NEEDED")
          .map(respondentKey),
      );
      available = available === null ? availableHere : intersect(available, availableHere);
    }

    results.push({
      slot: window[0],
      score: available?.size ?? 0,
      respondentKeys: [...(available ?? [])],
    });
  }

  return results.sort((a, b) => b.score - a.score);
}

function intersect<T>(a: Set<T>, b: Set<T>): Set<T> {
  return new Set([...a].filter((x) => b.has(x)));
}
