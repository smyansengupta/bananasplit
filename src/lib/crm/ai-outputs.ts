import { z } from "zod";

/**
 * What the CRM's AI must answer, feature by feature: every field present,
 * null when unknown (structured outputs need a closed shape). Pure and
 * client-safe, so the dialogs share the types. The server cleans every
 * answer again (dates checked, lengths capped) before anything is shown or
 * queued, and nothing here is applied without a person's review.
 */

export const SummaryOutput = z.object({
  /** "Where we stand": two to four sentences. */
  summary: z.string(),
  /** Up to five short facts worth knowing. */
  points: z.array(z.string()),
  nextStep: z.string().nullable(),
  notes: z.array(z.string()),
});
export type SummaryData = z.infer<typeof SummaryOutput>;

export const DraftOutput = z.object({
  subject: z.string(),
  body: z.string(),
  notes: z.array(z.string()),
});
export type DraftData = z.infer<typeof DraftOutput>;

export const BriefOutput = z.object({
  brief: z.string(),
  talkingPoints: z.array(z.string()),
  openPromises: z.array(z.string()),
  watchOuts: z.array(z.string()),
  notes: z.array(z.string()),
});
export type BriefData = z.infer<typeof BriefOutput>;

const promise = z.object({
  /** "Send the deck", "Confirm the budget". */
  text: z.string(),
  /** us: someone in the organization promised it; them: the other side did. */
  by: z.enum(["us", "them"]),
  /** YYYY-MM-DD when a day is given or implied. */
  dueDate: z.string().nullable(),
  /** The words it came from, verbatim, short. */
  quote: z.string(),
});

export const TranscriptOutput = z.object({
  summary: z.string(),
  nextSteps: z.array(promise),
  promises: z.array(promise),
  objections: z.array(z.string()),
  competitors: z.array(z.string()),
  sentiment: z.enum(["positive", "neutral", "mixed", "negative"]),
  /** Facts about them worth saving: a new title, a budget, a decision date. */
  facts: z.array(z.object({ field: z.enum(["title", "location", "nextStep", "expectedOn", "amount"]), value: z.string(), quote: z.string() })),
  notes: z.array(z.string()),
});
export type TranscriptData = z.infer<typeof TranscriptOutput>;
export type PromiseData = z.infer<typeof promise>;

export const ConversationOutput = z.object({
  platform: z.enum(["whatsapp", "linkedin", "instagram", "text", "email", "other"]),
  person: z.object({
    name: z.string().nullable(),
    handle: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    company: z.string().nullable(),
    title: z.string().nullable(),
  }),
  summary: z.string(),
  /** When the last message was sent, YYYY-MM-DD, if it shows. */
  lastMessageOn: z.string().nullable(),
  /** Who wrote last: us (the member) or them. */
  lastFrom: z.enum(["us", "them"]).nullable(),
  nextStep: promise.nullable(),
  promises: z.array(promise),
  notes: z.array(z.string()),
});
export type ConversationData = z.infer<typeof ConversationOutput>;

export const CardOutput = z.object({
  name: z.string().nullable(),
  title: z.string().nullable(),
  company: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  linkedin: z.string().nullable(),
  address: z.string().nullable(),
  /** Anything else on the card or badge (the event, a track, a booth). */
  other: z.string().nullable(),
  notes: z.array(z.string()),
});
export type CardData = z.infer<typeof CardOutput>;

export const AiFieldOutput = z.object({
  /** The value as text: a number as digits, a choice as its exact label, a link as a URL. Null when unknown. */
  value: z.string().nullable(),
  /** Which sources it rests on: "record" or a web result's number ("1", "2"). */
  sources: z.array(z.string()),
  confidence: z.enum(["high", "medium", "low"]),
});
export type AiFieldData = z.infer<typeof AiFieldOutput>;

export const ResearchOutput = z.object({
  summary: z.string(),
  /** Values for the record's empty or out-of-date fields, each from a numbered result. */
  facts: z.array(
    z.object({
      field: z.enum(["title", "companyName", "location", "linkedinUrl", "website", "industry", "size", "address", "description", "domain"]),
      value: z.string(),
      source: z.string(),
    }),
  ),
  news: z.array(z.object({ headline: z.string(), source: z.string() })),
  talkingPoints: z.array(z.string()),
  notes: z.array(z.string()),
});
export type ResearchData = z.infer<typeof ResearchOutput>;

export const EnrichOutput = z.object({
  facts: z.array(
    z.object({
      field: z.enum(["title", "companyName", "location", "linkedinUrl", "website", "industry", "size", "address", "description", "domain", "phone"]),
      value: z.string(),
      source: z.string(),
    }),
  ),
  notes: z.array(z.string()),
});
export type EnrichData = z.infer<typeof EnrichOutput>;

/** The Ask box's first step: which allowlisted question, with what. */
export const ASK_QUERIES = [
  "find_people",
  "find_companies",
  "find_items",
  "going_cold",
  "pipeline_summary",
  "timeline_of",
  "changes_since",
  "counts",
] as const;
export type AskQuery = (typeof ASK_QUERIES)[number];

export const AskPlanOutput = z.object({
  query: z.enum(ASK_QUERIES),
  /** Words to search names, titles, companies and notes for. */
  search: z.string().nullable(),
  /** A record's name (timeline_of, changes_since). */
  name: z.string().nullable(),
  kind: z.enum(["person", "company", "item"]).nullable(),
  /** A pipeline's name. */
  pipeline: z.string().nullable(),
  stage: z.string().nullable(),
  relationship: z.string().nullable(),
  /** Not contacted in this many days. */
  days: z.number().nullable(),
  /** YYYY-MM-DD. */
  since: z.string().nullable(),
  onlyMine: z.boolean(),
  openOnly: z.boolean(),
});
export type AskPlan = z.infer<typeof AskPlanOutput>;

export const AskAnswerOutput = z.object({
  answer: z.string(),
  /** Result numbers the answer names ("r1", "r4"), so they link. */
  cites: z.array(z.string()),
});
export type AskAnswer = z.infer<typeof AskAnswerOutput>;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A model's date, kept only when it's a real day. */
export function cleanDay(v: string | null | undefined): string | null {
  if (!v || !DAY.test(v)) return null;
  const d = new Date(`${v}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

/** Text from a model, trimmed and capped; null when empty. */
export function cleanText(v: string | null | undefined, max: number): string | null {
  const t = (v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Up to `n` cleaned, non-empty lines. */
export function cleanList(list: readonly (string | null | undefined)[], n: number, max = 300): string[] {
  return list.map((x) => cleanText(x, max)).filter((x): x is string => Boolean(x)).slice(0, n);
}

/** Dollars from micro-dollars, for the screen: "$0.42", "<$0.01". */
export function formatMicros(micros: number): string {
  if (micros <= 0) return "$0.00";
  const dollars = micros / 1_000_000;
  if (dollars < 0.01) return "<$0.01";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(dollars);
}
