import { z } from "zod";

/**
 * Ballot definitions: the suite's shape of a poll, the importer for the
 * website's poll JSON (src/lib/polls/*.json there), and the rule that marks
 * a cast ballot as excluded (test data, out of window, retired options).
 * Pure: shared by the website sync, the admin import and the tests.
 *
 * Stored shape (BallotDefinition.definition):
 *   { questions: [{ key, label, type, options: [{ key, label }] }] }
 * where type is slots (ranked picks), single, multi, yesno or text, and a
 * question key is the website's flat answer key "section.question".
 */

export const QUESTION_TYPES = ["slots", "single", "multi", "yesno", "text"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

const optionSchema = z.object({
  key: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(300),
});

const questionSchema = z.object({
  key: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(500),
  type: z.enum(QUESTION_TYPES),
  options: z.array(optionSchema).max(100).default([]),
});

export const definitionSchema = z.object({
  questions: z.array(questionSchema).max(100),
});

export type BallotQuestion = z.infer<typeof questionSchema>;
export type BallotDefinitionShape = z.infer<typeof definitionSchema>;

/** A stored definition, or an empty one when the JSON is not in the expected shape. */
export function readDefinition(json: unknown): BallotDefinitionShape {
  const parsed = definitionSchema.safeParse(json);
  return parsed.success ? parsed.data : { questions: [] };
}

export const YESNO_OPTIONS = [
  { key: "yes", label: "Yes" },
  { key: "no", label: "No" },
];

/** The options a question offers (yes/no for yesno, none for text). */
export function optionsOf(question: BallotQuestion): { key: string; label: string }[] {
  if (question.type === "yesno") return question.options.length ? question.options : YESNO_OPTIONS;
  if (question.type === "text") return [];
  return question.options;
}

/** Label lookups for a definition: question labels and option labels per question. */
export function definitionLabels(def: BallotDefinitionShape) {
  const questions = new Map<string, BallotQuestion>();
  for (const q of def.questions) questions.set(q.key, q);
  return {
    question(key: string): string {
      return questions.get(key)?.label ?? key;
    },
    choice(questionKey: string, choiceKey: string | null): string {
      if (choiceKey === null) return "";
      const q = questions.get(questionKey);
      const found = q ? optionsOf(q).find((o) => o.key === choiceKey) : undefined;
      return found?.label ?? choiceKey;
    },
    type(key: string): QuestionType | null {
      return questions.get(key)?.type ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// The website's poll JSON
// ---------------------------------------------------------------------------

const websiteOption = z.object({
  key: z.string(),
  label: z.string().optional(),
});
const websiteQuestion = z.object({
  key: z.string(),
  type: z.string(),
  prompt: z.string().optional(),
  label: z.string().optional(),
  options: z.array(websiteOption).optional(),
  pool: z.array(websiteOption).optional(),
});
const websitePoll = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,99}$/, "The poll slug is lowercase letters, digits and dashes."),
  title: z.string().min(1).max(300),
  opensAt: z.string().optional().nullable(),
  closesAt: z.string().optional().nullable(),
  sections: z.array(
    z.object({
      key: z.string(),
      label: z.string().optional(),
      questions: z.array(websiteQuestion).default([]),
    }),
  ),
});

export interface ImportedDefinition {
  slug: string;
  title: string;
  opensAt: Date | null;
  closesAt: Date | null;
  definition: BallotDefinitionShape;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Converts a website poll file into a suite definition: each section's
 * questions become "section.question" keys (the website's answer keys),
 * `pool` (slots) or `options` become options, and unknown question types
 * are skipped the way the website's renderer skips them.
 */
export function fromWebsitePoll(json: unknown): ImportedDefinition {
  const poll = websitePoll.parse(json);
  const questions: BallotQuestion[] = [];
  for (const section of poll.sections) {
    for (const q of section.questions) {
      if (!(QUESTION_TYPES as readonly string[]).includes(q.type)) continue;
      const type = q.type as QuestionType;
      const source = type === "slots" ? (q.pool ?? q.options ?? []) : (q.options ?? []);
      questions.push({
        key: `${section.key}.${q.key}`,
        label: (q.prompt ?? q.label ?? q.key).slice(0, 500),
        type,
        options:
          type === "yesno" || type === "text"
            ? []
            : source.map((o) => ({ key: o.key, label: (o.label ?? o.key).slice(0, 300) })),
      });
    }
  }
  const definition = definitionSchema.parse({ questions });
  return {
    slug: poll.slug,
    title: poll.title,
    opensAt: parseDate(poll.opensAt),
    closesAt: parseDate(poll.closesAt),
    definition,
  };
}

/**
 * Accepts either the website's poll file or the suite's own shape
 * ({ slug, title, opensAt?, closesAt?, questions }) and returns the suite
 * definition. Throws a readable Error for anything else.
 */
export function parseDefinitionImport(json: unknown): ImportedDefinition {
  if (json && typeof json === "object" && "sections" in (json as object)) {
    return fromWebsitePoll(json);
  }
  const own = z
    .object({
      slug: websitePoll.shape.slug,
      title: z.string().min(1).max(300),
      opensAt: z.string().optional().nullable(),
      closesAt: z.string().optional().nullable(),
      questions: definitionSchema.shape.questions,
    })
    .safeParse(json);
  if (!own.success) {
    throw new Error(
      "Paste the website's poll file (with sections) or { slug, title, questions: [{ key, label, type, options }] }.",
    );
  }
  return {
    slug: own.data.slug,
    title: own.data.title,
    opensAt: parseDate(own.data.opensAt),
    closesAt: parseDate(own.data.closesAt),
    definition: { questions: own.data.questions },
  };
}

// ---------------------------------------------------------------------------
// Excluding test and out-of-window ballots
// ---------------------------------------------------------------------------

/**
 * Slugs that are never real polls: the website's load and smoke tests
 * (loadtest-*, smoke-test-*, smoke-*). Ballots under them are not imported.
 */
const TEST_SLUG = /^(loadtest|load-test|smoke|smoke-test|smoketest)([-_].*)?$/i;

export function isTestSlug(slug: string): boolean {
  return TEST_SLUG.test(slug.trim());
}

/** Reasons a ballot does not count, in the order they are checked. */
export type ExclusionReason =
  | "test-slug"
  | "test-poll"
  | "no-definition"
  | "before-window"
  | "after-window"
  | "retired-option"
  | "suppressed";

/** Admin suppression survives every re-evaluation. */
export const STICKY_REASONS: readonly string[] = ["suppressed"];

function floorToHour(d: Date): Date {
  const t = new Date(d.getTime());
  t.setUTCMinutes(0, 0, 0);
  return t;
}

function answerValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return [value];
}

/**
 * Why a ballot is excluded, or null when it counts.
 *
 * - test-slug / test-poll: load tests, smoke tests and definitions flagged isTest.
 * - no-definition: no definition for the slug yet (re-evaluated on import).
 * - before-window / after-window: cast outside [opensAt, closesAt). The
 *   website rounds castAt DOWN to the hour, so the window's start is rounded
 *   down too: a ballot cast at 18:59 for a poll opening at 18:30 still counts.
 * - retired-option: an answer names a question or option the poll no longer
 *   offers. Pre-launch test ballots cast into a real slug look like this
 *   (for example options that were replaced before the poll went live).
 */
export function classifyBallot(
  ballot: { pollSlug: string; castAt: Date; answers: unknown },
  def: {
    isTest: boolean;
    opensAt: Date | null;
    closesAt: Date | null;
    definition: BallotDefinitionShape;
  } | null,
): ExclusionReason | null {
  if (isTestSlug(ballot.pollSlug)) return "test-slug";
  if (!def) return "no-definition";
  if (def.isTest) return "test-poll";
  if (def.opensAt && ballot.castAt < floorToHour(def.opensAt)) return "before-window";
  if (def.closesAt && ballot.castAt >= def.closesAt) return "after-window";

  const answers =
    ballot.answers && typeof ballot.answers === "object" && !Array.isArray(ballot.answers)
      ? (ballot.answers as Record<string, unknown>)
      : {};
  if (def.definition.questions.length > 0) {
    const questions = new Map(def.definition.questions.map((q) => [q.key, q]));
    for (const [key, value] of Object.entries(answers)) {
      const q = questions.get(key);
      if (!q) return "retired-option";
      if (q.type === "text") continue;
      const allowed = new Set(optionsOf(q).map((o) => o.key));
      for (const v of answerValues(value)) {
        if (v === null || v === undefined || v === "") continue;
        const k = typeof v === "boolean" ? (v ? "yes" : "no") : String(v);
        if (!allowed.has(k)) return "retired-option";
      }
    }
  }
  return null;
}

export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  "test-slug": "Test poll slug",
  "test-poll": "Test poll",
  "no-definition": "No poll definition yet",
  "before-window": "Cast before the poll opened",
  "after-window": "Cast after the poll closed",
  "retired-option": "Uses an option the poll no longer has",
  suppressed: "Suppressed by an admin",
};

export function exclusionLabel(reason: string | null | undefined): string {
  if (!reason) return "";
  return (EXCLUSION_LABELS as Record<string, string>)[reason] ?? reason;
}
