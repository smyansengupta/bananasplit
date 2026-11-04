/**
 * Relationship strength from every touchpoint, not only email (docs/
 * features/crm.md, "What makes ours better" 2): meetings together, events
 * attended, form responses, payments, tasks and notes all count. Pure: the
 * job (src/server/crm/strength.ts) gathers the touchpoints and writes
 * CrmPerson/CrmCompany.strength.
 *
 * Each touchpoint is worth its kind's weight, halved every HALF_LIFE_DAYS
 * since it happened (a meeting last week counts far more than one two years
 * ago). The sum maps onto 0-100 with a soft ceiling, so a handful of recent
 * meetings is "strong" and nobody runs off the top.
 */

export const HALF_LIFE_DAYS = 90;

export const TOUCH_WEIGHTS: Record<string, number> = {
  MEETING: 10,
  CALL: 8,
  EMAIL: 5,
  TEXT: 4,
  CHECK_IN: 6,
  RSVP: 3,
  FORM_RESPONSE: 4,
  PAYMENT: 8,
  TASK: 2,
  NOTE: 2,
  SEQUENCE_STEP: 1,
  STAGE_CHANGE: 1,
  FIELD_CHANGE: 0,
  SYSTEM: 0,
};

export interface Touchpoint {
  kind: string;
  at: Date;
  /** Who in the organization it was with (for "knows them best"). */
  actorId?: string | null;
}

/** Points for one touchpoint at `now`. Future ones (a meeting next week) count as today. */
export function touchValue(t: Touchpoint, now: Date): number {
  const weight = TOUCH_WEIGHTS[t.kind] ?? 1;
  if (weight === 0) return 0;
  const days = Math.max(0, (now.getTime() - t.at.getTime()) / 86_400_000);
  return weight * Math.pow(0.5, days / HALF_LIFE_DAYS);
}

/** 0-100. 30 recent points is about 63; 60 about 86. */
export function strengthOf(touches: readonly Touchpoint[], now: Date = new Date()): number {
  const sum = touches.reduce((acc, t) => acc + touchValue(t, now), 0);
  return Math.round(100 * (1 - Math.exp(-sum / 30)));
}

export type StrengthBand = "none" | "weak" | "fair" | "strong";

export function strengthBand(strength: number): StrengthBand {
  if (strength <= 0) return "none";
  if (strength < 35) return "weak";
  if (strength < 70) return "fair";
  return "strong";
}

export const STRENGTH_LABELS: Record<StrengthBand, string> = {
  none: "No contact yet",
  weak: "Weak",
  fair: "Warm",
  strong: "Strong",
};

/** Who in the organization knows them best: members by their own touchpoints' worth. */
export function knowsBest(
  touches: readonly Touchpoint[],
  now: Date = new Date(),
  take = 3,
): { userId: string; strength: number }[] {
  const by = new Map<string, Touchpoint[]>();
  for (const t of touches) {
    if (!t.actorId) continue;
    const list = by.get(t.actorId);
    if (list) list.push(t);
    else by.set(t.actorId, [t]);
  }
  return [...by.entries()]
    .map(([userId, list]) => ({ userId, strength: strengthOf(list, now) }))
    .filter((x) => x.strength > 0)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, take);
}

/**
 * Going cold: someone you were in touch with whose cadence has lapsed (or,
 * without one, nobody has been in touch for COLD_AFTER_DAYS).
 */
export const COLD_AFTER_DAYS = 60;

export function isGoingCold(
  person: { lastContactedAt: Date | null; keepInTouchDays: number | null },
  now: Date = new Date(),
): boolean {
  if (!person.lastContactedAt) return false;
  const limit = person.keepInTouchDays ?? COLD_AFTER_DAYS;
  return now.getTime() - person.lastContactedAt.getTime() > limit * 86_400_000;
}
