/**
 * What the Ask card (?open=ask; the Ask design) does with what was typed or
 * pasted: answer a question, show a change before making it, or read a
 * pasted chat for people and next steps. Also whether a toolbar search
 * looks like something to ask rather than a name to find, and when an
 * answer's people can show as a People list. Pure.
 */

import type { AskPlan } from "./ai-outputs";
import { COLD_AFTER_DAYS } from "./strength";

export type AskIntent = "question" | "change" | "paste";

const QUESTION_WORDS =
  /^(who|whom|whose|what|which|when|where|why|how|is|are|was|were|do|does|did|has|have|had|can|could|should|will|would|show|list|find|count|any)\b/i;

const CHANGE_VERBS =
  /^(move|give|assign|reassign|hand|set|change|mark|update|rename|close|make|put|push|snooze|add (?:a )?next step|change the owner)\b/i;

/** A chat line: "Rosa: ...", "[10:42] Ben: ...", "You: ...". */
const SPEAKER = /^\s*(?:\[[^\]]{1,20}\]\s*)?[A-Z][\w.'-]*(?: [A-Z][\w.'-]*){0,2}:\s+\S/;

export function askIntent(raw: string): AskIntent {
  const text = raw.trim();
  if (!text) return "question";
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const speakers = lines.filter((l) => SPEAKER.test(l)).length;
  if (speakers >= 2 || lines.length >= 3 || (text.length > 280 && !text.endsWith("?")))
    return "paste";
  if (text.endsWith("?") || QUESTION_WORDS.test(text)) return "question";
  if (CHANGE_VERBS.test(text)) return "change";
  return "question";
}

/**
 * Whether a toolbar search is really something to ask: a question, a
 * change, or a sentence. A name, an email or a word or two stays a search.
 */
export function looksLikeAsk(raw: string): boolean {
  const text = raw.trim();
  if (!text) return false;
  if (/^\S+@\S+$/.test(text)) return false;
  if (text.includes("\n")) return true;
  if (text.endsWith("?")) return true;
  const words = text.split(/\s+/).length;
  if (QUESTION_WORDS.test(text) && words >= 3) return true;
  if (CHANGE_VERBS.test(text) && words >= 3) return true;
  return words >= 6;
}

/** Where the toolbar hands typed text to the Ask card (session storage, never the URL). */
export const ASK_DRAFT_KEY = "crm-ask-draft";

/** The People page's filters for a plan, when they pick out the same people. */
export function peopleQueryOf(
  plan: AskPlan,
  types: readonly { id?: string; label?: string }[],
): Record<string, string> | null {
  const mine: Record<string, string> = plan.onlyMine ? { owner: "me" } : {};
  if (
    plan.query === "going_cold" &&
    plan.kind !== "company" &&
    (plan.days ?? 60) === COLD_AFTER_DAYS
  ) {
    return { due: "cold", ...mine };
  }
  if (plan.query !== "find_people" || plan.days) return null;
  if (plan.relationship) {
    const type = types.find((t) =>
      t.label?.toLowerCase().includes(plan.relationship!.toLowerCase()),
    );
    return type?.id ? { rel: type.id, ...mine } : null;
  }
  if (plan.search?.trim()) return { q: plan.search.trim().slice(0, 100), ...mine };
  return null;
}
