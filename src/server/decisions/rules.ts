import { can } from "@/lib/auth/permissions";
import type { Role } from "@/generated/prisma/enums";

/**
 * Decisions' rules, free of the database so they can be tested on their
 * own: what a decision may say, who may settle one, and a linked poll's
 * standings. The database holds the same who-may-change rule
 * (prisma/migrations/20261102100000_home_widgets).
 */

export const QUESTION_MAX = 200;
export const DETAIL_MAX = 2000;
export const OUTCOME_MAX = 500;
/** Links a new decision may start with. */
export const LINKS_MAX = 10;

type Actor = { userId: string; role: Role | null };
type Settled = { ownerId: string | null; createdById: string | null };

/**
 * Who may decide, drop or link a decision: its owner, whoever raised it, or
 * an owner or admin. One nobody owns is its raiser's or an admin's; anyone
 * else takes it first (takeDecision).
 */
export function canSettle(actor: Actor, decision: Settled): boolean {
  return (
    (decision.ownerId !== null && decision.ownerId === actor.userId) ||
    (decision.createdById !== null && decision.createdById === actor.userId) ||
    can(actor, "events.write")
  );
}

/** Text squeezed to one clean line, or null when empty. */
export function oneLine(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text || null;
}

/** The question and detail cleaned up, or what's wrong with them. */
export function cleanDecision(
  input: unknown,
): { ok: true; question: string; detail: string | null } | { ok: false; error: string } {
  const raw = (input ?? {}) as { question?: unknown; detail?: unknown };
  const question = oneLine(raw.question);
  if (!question) return { ok: false, error: "Say what needs deciding." };
  if (question.length > QUESTION_MAX) {
    return { ok: false, error: `Keep it to ${QUESTION_MAX} characters.` };
  }
  const detail = typeof raw.detail === "string" ? raw.detail.trim() || null : null;
  if (detail && detail.length > DETAIL_MAX) {
    return { ok: false, error: `Keep the detail to ${DETAIL_MAX} characters.` };
  }
  return { ok: true, question, detail };
}

/** The outcome, or what's wrong with it. */
export function cleanOutcome(
  value: unknown,
): { ok: true; outcome: string } | { ok: false; error: string } {
  const outcome = oneLine(value);
  if (!outcome) return { ok: false, error: "Say what was decided." };
  if (outcome.length > OUTCOME_MAX) {
    return { ok: false, error: `Keep the outcome to ${OUTCOME_MAX} characters.` };
  }
  return { ok: true, outcome };
}

export interface PollStanding {
  label: string;
  votes: number;
  /** Share of the people who voted, 0 to 100 (multiple choice can add past 100). */
  pct: number;
}

/**
 * A poll's options with their votes, leader first (ties keep the poll's
 * order). Shares are of the people who voted, so "4 of 7" is 57%.
 */
export function standings(
  options: readonly { id: string; label: string }[],
  counts: readonly { optionId: string; votes: number }[],
  voters: number,
): PollStanding[] {
  return options
    .map((o, order) => {
      const votes = counts.find((c) => c.optionId === o.id)?.votes ?? 0;
      return {
        label: o.label,
        votes,
        pct: voters > 0 ? Math.round((votes / voters) * 100) : 0,
        order,
      };
    })
    .sort((a, b) => b.votes - a.votes || a.order - b.order)
    .map(({ label, votes, pct }) => ({ label, votes, pct }));
}
