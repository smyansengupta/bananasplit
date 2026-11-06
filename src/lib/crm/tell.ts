import { z } from "zod";

/**
 * Telling the CRM a change in words (the Ask card): the shape the model
 * reads a sentence into, a no-AI reading of the plain cases, and finding
 * the member and the stage it names. Pure; the server part is
 * src/server/crm/tell.ts.
 */

export const ChangePlanOutput = z.object({
  /** The record's name as written. */
  record: z.string().nullable(),
  kind: z.enum(["person", "company", "item"]).nullable(),
  /** A stage name, for an item. */
  stage: z.string().nullable(),
  /** A member's name to give it to. */
  owner: z.string().nullable(),
  /** In dollars. */
  amount: z.number().nullable(),
  nextStep: z.string().nullable(),
  /** YYYY-MM-DD. */
  nextStepOn: z.string().nullable(),
  /** YYYY-MM-DD: when to follow up with a person or company. */
  followUpOn: z.string().nullable(),
  notes: z.array(z.string()),
});
export type ChangePlan = z.infer<typeof ChangePlanOutput>;

/** No AI: "move X to Y", "give it to Z", "assign X to Z". */
export function standinChange(text: string): ChangePlan {
  const t = text.trim();
  const move = /\bmove\s+(.+?)\s+to\s+(.+?)(?:\s+and\b|[.,]|$)/i.exec(t);
  const give =
    /\b(?:[Gg]ive|[Aa]ssign|[Hh]and)\s+(?:(?:it|them)\s+)?(?:(.+?)\s+)?to\s+([A-Z][\w'-]*(?:\s+[A-Z][\w'-]*)?)/.exec(
      t,
    );
  return {
    record: move?.[1]?.trim() ?? give?.[1]?.trim() ?? null,
    kind: move ? "item" : null,
    stage: move?.[2]?.trim() ?? null,
    owner: give?.[2]?.trim() ?? null,
    amount: null,
    nextStep: null,
    nextStepOn: null,
    followUpOn: null,
    notes: ["Read by the local stand-in (no AI)."],
  };
}

/** The member whose name matches: the full name, else one whose first name does. */
export function matchMember(
  name: string,
  members: readonly { id: string; name: string }[],
): { id: string; name: string } | null {
  const want = name.trim().toLowerCase();
  if (!want) return null;
  const exact = members.filter((m) => m.name.toLowerCase() === want);
  if (exact.length === 1) return exact[0]!;
  const first = members.filter(
    (m) => m.name.toLowerCase().split(/\s+/)[0] === want.split(/\s+/)[0],
  );
  return first.length === 1 ? first[0]! : null;
}

/** The stage whose name matches, exactly first, else the one that contains it. */
export function matchStage<T extends { name: string }>(
  name: string,
  stages: readonly T[],
): T | null {
  const want = name.trim().toLowerCase();
  if (!want) return null;
  const exact = stages.find((s) => s.name.toLowerCase() === want);
  if (exact) return exact;
  const loose = stages.filter(
    (s) => s.name.toLowerCase().includes(want) || want.includes(s.name.toLowerCase()),
  );
  return loose.length === 1 ? loose[0]! : null;
}
