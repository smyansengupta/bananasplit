import { formatMoney } from "./fields";
import { GOAL_METRICS, periodOf, type GoalMetric, type Period } from "./forecast";

/**
 * The goal card (docs/features/crm.md, "Redesign"): what a goal counts, in
 * plain words, and where the pace lands by the period's end. Pure and
 * client-safe; the card recomputes it as you change what, who and when.
 */

export const GOAL_WHAT: Record<GoalMetric, { label: string; unit: string; one: string; many: string }> = {
  amount_won: { label: "Money won", unit: "won in deals", one: "", many: "" },
  items_won: { label: "Deals won", unit: "deals won", one: "deal", many: "deals" },
  people_reached: { label: "People reached", unit: "people reached", one: "person", many: "people" },
  replies: { label: "Replies", unit: "replies to outreach", one: "reply", many: "replies" },
  meetings: { label: "Meetings", unit: "meetings held", one: "meeting", many: "meetings" },
};

export const GOAL_WHATS: readonly GoalMetric[] = GOAL_METRICS;

export function isMoney(metric: GoalMetric): boolean {
  return metric === "amount_won";
}

/** A goal's number as words: "$18,500", "7 deals", "1 reply". Money is in cents. */
export function formatGoal(metric: GoalMetric, n: number): string {
  if (isMoney(metric)) return formatMoney(Math.round(n));
  const w = GOAL_WHAT[metric];
  const v = Math.round(n);
  return `${v.toLocaleString("en-US")} ${v === 1 ? w.one : w.many}`;
}

/** The target as typed ("$25,000", "10") in the goal's units (dollars for money), or null. */
export function parseTarget(text: string): number | null {
  const digits = text.replace(/[^0-9.]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The periods to pick from: this quarter and this year (and the goal's own, when it's another). */
export function goalPeriods(today: string, current?: { start: string; end: string; key: string; label: string } | null): {
  key: string;
  label: string;
  period: Period | { start: string; end: string; key: string; label: string };
}[] {
  const q = periodOf("quarter", today);
  const y = periodOf("year", today);
  const out: { key: string; label: string; period: Period | { start: string; end: string; key: string; label: string } }[] = [
    { key: q.key, label: "This quarter", period: q },
    { key: y.key, label: "This year", period: y },
  ];
  if (current && current.key !== q.key && current.key !== y.key) {
    out.push({ key: current.key, label: current.label, period: current });
  }
  return out;
}

const DAY = 86_400_000;

/**
 * Where it lands by the end at the pace so far: what's done over the share
 * of the period gone (days, both ends counted). Before the period starts,
 * nothing is projected beyond what's done.
 */
export function projectPace(actual: number, period: { start: string; end: string }, today: string): number {
  const s = Date.parse(period.start);
  const e = Date.parse(period.end) + DAY;
  const t = Math.min(e, Date.parse(today) + DAY);
  if (t <= s || e <= s) return actual;
  const share = (t - s) / (e - s);
  return actual / share;
}

/** "Dec 31" for a yyyy-mm-dd. */
function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export interface PaceWords {
  /** "At this pace you'll reach $21,300 by Dec 31." */
  pace: string;
  /** "So far $18,500. About $3,700 short of the $25,000 target." */
  sub: string;
}

/** The live pace line under the target (money in cents). */
export function paceWords(
  metric: GoalMetric,
  actual: number,
  target: number,
  period: { start: string; end: string },
  today: string,
): PaceWords {
  const projected = projectPace(actual, period, today);
  const round = (v: number) => (isMoney(metric) ? Math.round(v / 10_000) * 10_000 : Math.round(v));
  const pace = Math.max(actual, round(projected));
  const ended = Date.parse(today) > Date.parse(period.end);
  const short = target - (ended ? actual : pace);
  return {
    pace: ended
      ? `It ended at ${formatGoal(metric, actual)}.`
      : `At this pace you'll reach ${formatGoal(metric, pace)} by ${dayLabel(period.end)}.`,
    sub:
      `So far ${formatGoal(metric, actual)}. ` +
      (target <= 0
        ? "Set a target to see how far it is."
        : short > 0
          ? `About ${formatGoal(metric, short)} short of the ${formatGoal(metric, target)} target.`
          : `That clears the ${formatGoal(metric, target)} target.`),
  };
}

export type GoalStanding = "won" | "ahead" | "on-pace" | "behind";

/** Hit, ahead, on pace or behind, from where it is against where it should be by now. */
export function goalStanding(a: { share: number; pace: number; onTrack: boolean }): GoalStanding {
  if (a.share >= 1) return "won";
  if (!a.onTrack) return "behind";
  return a.share >= a.pace * 1.1 ? "ahead" : "on-pace";
}

/** A goal's standing in a few words: "Goal hit", "On pace", "About $3,000 behind pace". */
export function standingWords(
  metric: GoalMetric,
  a: { target: number; actual: number; share: number; pace: number; onTrack: boolean },
): string {
  const standing = goalStanding(a);
  if (standing === "won") {
    const over = Math.round((a.share - 1) * 100);
    return over >= 1 ? `Goal hit, ${over}% over` : "Goal hit";
  }
  if (standing === "ahead") return "Ahead of pace";
  if (standing === "on-pace") return "On pace";
  const gap = a.target * a.pace - a.actual;
  const rounded = isMoney(metric) ? Math.max(100, Math.round(gap / 100) * 100) : Math.max(1, Math.ceil(gap));
  return `About ${formatGoal(metric, rounded)} behind pace`;
}

/** The card's title: "Money won this quarter", "Kristine's replies this year". */
export function goalTitle(metric: GoalMetric, who: { me: boolean; name: string } | null, periodLabel: string): string {
  const what = GOAL_WHAT[metric].label;
  const when =
    periodLabel === "This quarter" || periodLabel === "This year" ? periodLabel.toLowerCase() : `in ${periodLabel}`;
  if (!who) return `${what} ${when}`;
  const owner = who.me ? "Your" : `${who.name.split(" ")[0]}'s`;
  return `${owner} ${what.toLowerCase()} ${when}`;
}
