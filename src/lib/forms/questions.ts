import { z } from "zod";

import type { FieldType } from "@/lib/databases/fields";

/**
 * A form's questions, as stored in Form.questions (validated here, never
 * trusted). Each question that takes an answer is one field of the form's
 * database; `fieldId` ties the two together once the field exists, so
 * renaming a question renames its column and a choice's id is its database
 * choice's id.
 *
 * Answers map onto the database's own field types, so a form's responses
 * are an ordinary club database (sortable, filterable, exportable):
 * uploads are links to the file in Files, a ranking is the choices in
 * order, one per line, ratings and scales are numbers.
 */

export const QUESTION_TYPES = [
  "short",
  "long",
  "choice",
  "checkboxes",
  "dropdown",
  "yesno",
  "rating",
  "scale",
  "ranking",
  "number",
  "email",
  "phone",
  "date",
  "link",
  "file",
  "image",
  "signature",
  "member",
  "section",
  "hidden",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_META: Record<
  QuestionType,
  { label: string; icon: string; field: FieldType | null; group: QuestionGroup }
> = {
  short: { label: "Short answer", icon: "Type", field: "TEXT", group: "text" },
  long: { label: "Long answer", icon: "AlignLeft", field: "LONG_TEXT", group: "text" },
  choice: { label: "Multiple choice", icon: "CircleDot", field: "SELECT", group: "choice" },
  checkboxes: { label: "Checkboxes", icon: "ListChecks", field: "MULTI_SELECT", group: "choice" },
  dropdown: { label: "Dropdown", icon: "ChevronDown", field: "SELECT", group: "choice" },
  yesno: { label: "Yes or no", icon: "SquareCheck", field: "CHECKBOX", group: "choice" },
  rating: { label: "Rating", icon: "Star", field: "NUMBER", group: "scale" },
  scale: { label: "Scale", icon: "Gauge", field: "NUMBER", group: "scale" },
  ranking: { label: "Ranking", icon: "ListOrdered", field: "LONG_TEXT", group: "choice" },
  number: { label: "Number", icon: "Hash", field: "NUMBER", group: "text" },
  email: { label: "Email", icon: "Mail", field: "EMAIL", group: "contact" },
  phone: { label: "Phone", icon: "Phone", field: "PHONE", group: "contact" },
  date: { label: "Date", icon: "Calendar", field: "DATE", group: "text" },
  link: { label: "Link", icon: "Link", field: "URL", group: "contact" },
  file: { label: "File upload", icon: "Upload", field: "URL", group: "upload" },
  image: { label: "Image upload", icon: "Image", field: "URL", group: "upload" },
  /** Drawn on the screen, saved to Files as a picture; the column links to it. */
  signature: { label: "Signature", icon: "PenLine", field: "URL", group: "upload" },
  member: { label: "Member", icon: "User", field: "MEMBER", group: "contact" },
  section: { label: "Section break", icon: "SeparatorHorizontal", field: null, group: "layout" },
  hidden: { label: "Hidden field", icon: "EyeOff", field: "TEXT", group: "layout" },
};

export type QuestionGroup = "text" | "choice" | "scale" | "contact" | "upload" | "layout";

export const QUESTION_GROUPS: { id: QuestionGroup; label: string }[] = [
  { id: "text", label: "Text" },
  { id: "choice", label: "Choices" },
  { id: "scale", label: "Ratings" },
  { id: "contact", label: "Contact" },
  { id: "upload", label: "Uploads" },
  { id: "layout", label: "Layout" },
];

/** Types whose answer is one of `options`. */
export function hasOptions(type: QuestionType): boolean {
  return type === "choice" || type === "checkboxes" || type === "dropdown" || type === "ranking";
}

/** Types a skip rule can hang off (one choice picks the path). */
export function canBranch(type: QuestionType): boolean {
  return type === "choice" || type === "dropdown" || type === "yesno";
}

/** Types that take no answer of their own. */
export function takesAnswer(type: QuestionType): boolean {
  return type !== "section";
}

export const FORM_LIMITS = {
  questions: 50,
  options: 50,
  title: 200,
  questionTitle: 300,
  help: 1000,
  optionLabel: 80,
  /** Per uploaded file. */
  uploadBytes: 10 * 1024 * 1024,
} as const;

const ID = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);

const optionSchema = z.object({
  id: ID,
  label: z.string().trim().min(1).max(FORM_LIMITS.optionLabel),
});
export type QuestionOption = z.infer<typeof optionSchema>;

const ruleSchema = z.object({
  /** An option id, or "yes" / "no" for a yes-or-no question. */
  when: z.string().min(1).max(32),
  /** Where to go next: a later question's id, or "end". */
  goTo: z.string().min(1).max(32),
});
export type SkipRule = z.infer<typeof ruleSchema>;

export const questionSchema = z.object({
  id: ID,
  type: z.enum(QUESTION_TYPES),
  title: z.string().max(FORM_LIMITS.questionTitle),
  help: z.string().max(FORM_LIMITS.help).optional(),
  required: z.boolean().default(false),
  options: z.array(optionSchema).max(FORM_LIMITS.options).optional(),
  /** Choices: an "Other" box whose answer becomes a new choice. */
  allowOther: z.boolean().optional(),
  /** Scale: the range (1 to 5 or 0 to 10, say). Rating: stars out of `max`. */
  min: z.number().int().min(0).max(1).optional(),
  max: z.number().int().min(2).max(10).optional(),
  /** Hidden field: the link's query parameter it reads (?source=instagram). */
  param: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,31}$/)
    .optional(),
  /** The database field this question writes into, once made. */
  fieldId: z.string().max(64).optional(),
  logic: z
    .array(ruleSchema)
    .max(FORM_LIMITS.options + 2)
    .optional(),
});
export type Question = z.infer<typeof questionSchema>;

export const questionsSchema = z.array(questionSchema).max(FORM_LIMITS.questions);

/** The stored questions, or [] when they don't parse (never throws). */
export function readQuestions(raw: unknown): Question[] {
  const parsed = questionsSchema.safeParse(raw ?? []);
  return parsed.success ? parsed.data : [];
}

/** A short random id for a new question or option. */
export function newId(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 10);
}

/** A new question of `type`, with the parts that type needs. */
export function blankQuestion(type: QuestionType, title = ""): Question {
  const q: Question = { id: newId(), type, title, required: false };
  if (hasOptions(type)) q.options = [opt("Option 1"), opt("Option 2")];
  if (type === "rating") q.max = 5;
  if (type === "scale") {
    q.min = 1;
    q.max = 10;
  }
  if (type === "hidden") q.param = "source";
  return q;
}

export function opt(label: string): QuestionOption {
  return { id: newId(), label };
}

/** The scale's ends, defaulted. */
export function scaleRange(q: Pick<Question, "type" | "min" | "max">): [number, number] {
  if (q.type === "rating") return [1, q.max ?? 5];
  return [q.min ?? 1, q.max ?? 10];
}

/**
 * The question after `current`, given the answer to it: the first skip rule
 * that matches sends the person there ("end" finishes the form), otherwise
 * it's the next question in order. Returns null at the end.
 */
export function nextQuestionId(
  questions: readonly Question[],
  currentId: string,
  answer: unknown,
): string | null {
  const at = questions.findIndex((q) => q.id === currentId);
  if (at === -1) return null;
  const q = questions[at]!;
  const key =
    q.type === "yesno"
      ? answer === true
        ? "yes"
        : answer === false || answer === null || answer === undefined
          ? "no"
          : null
      : typeof answer === "string"
        ? answer
        : null;
  const rule = key ? q.logic?.find((r) => r.when === key) : undefined;
  if (rule) {
    if (rule.goTo === "end") return null;
    // Only forward jumps: a rule pointing back (or at a question since
    // deleted) falls through to the next one, so a form can never loop.
    const target = questions.findIndex((x) => x.id === rule.goTo);
    if (target > at) return questions[target]!.id;
  }
  // Hidden fields are filled from the link, never shown.
  for (let i = at + 1; i < questions.length; i++) {
    if (questions[i]!.type !== "hidden") return questions[i]!.id;
  }
  return null;
}

/** The first question a person sees (hidden fields are skipped). */
export function firstQuestionId(questions: readonly Question[]): string | null {
  return questions.find((q) => q.type !== "hidden")?.id ?? null;
}

/**
 * The questions a person actually walked through for these answers, in
 * order: what "required" applies to on submit, since a skipped question
 * can't be required of them.
 */
export function pathThrough(
  questions: readonly Question[],
  answers: Readonly<Record<string, unknown>>,
): Question[] {
  const path: Question[] = [];
  let id = firstQuestionId(questions);
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const q = questions.find((x) => x.id === id)!;
    path.push(q);
    id = nextQuestionId(questions, id, answers[id]);
  }
  return path;
}

// ---- Templates -------------------------------------------------------------

export interface FormTemplate {
  id: string;
  name: string;
  /** What it's for, in a few words. */
  blurb: string;
  title: string;
  review: boolean;
  questions: () => Question[];
}

const q = (
  type: QuestionType,
  title: string,
  extra: Partial<Omit<Question, "id" | "type" | "title">> = {},
): Question => ({ ...blankQuestion(type, title), ...extra });

export const FORM_TEMPLATES: readonly FormTemplate[] = [
  {
    id: "blank",
    name: "Blank form",
    blurb: "Start from nothing",
    title: "Untitled form",
    review: false,
    questions: () => [q("short", "What's your name?", { required: true })],
  },
  {
    id: "application",
    name: "Organization application",
    blurb: "Resume, short answers, review",
    title: "Application",
    review: true,
    questions: () => [
      q("short", "What's your name?", { required: true }),
      q("email", "Your school email", { required: true }),
      q("choice", "Which team do you want to join?", {
        required: true,
        options: [opt("Design"), opt("Engineering"), opt("Events"), opt("Outreach")],
      }),
      q("long", "Why do you want to join?", { required: true }),
      q("file", "Drop your resume", { help: "PDF, up to 10 MB." }),
      q("scale", "How many hours a week can you give?", { min: 1, max: 10 }),
    ],
  },
  {
    id: "interest",
    name: "Interest form",
    blurb: "Name, year, what you want to do",
    title: "Interest form",
    review: false,
    questions: () => [
      q("short", "What's your name?", { required: true }),
      q("email", "Your email", { required: true }),
      q("dropdown", "What year are you?", {
        options: [
          opt("First year"),
          opt("Second year"),
          opt("Third year"),
          opt("Fourth year"),
          opt("Grad"),
        ],
      }),
      q("checkboxes", "What are you interested in?", {
        options: [opt("Building"), opt("Workshops"), opt("Socials"), opt("Leading")],
        allowOther: true,
      }),
    ],
  },
  {
    id: "feedback",
    name: "Event feedback",
    blurb: "Ratings and one open question",
    title: "How was it?",
    review: false,
    questions: () => [
      q("rating", "How was the event?", { required: true, max: 5 }),
      q("scale", "How likely are you to come again?", { min: 0, max: 10 }),
      q("long", "Anything we should change?"),
    ],
  },
  {
    id: "signup",
    name: "Sign-up sheet",
    blurb: "Slots with a cap per slot",
    title: "Sign-up sheet",
    review: false,
    questions: () => [
      q("short", "What's your name?", { required: true }),
      q("phone", "Phone number"),
      q("choice", "Which slot?", {
        required: true,
        options: [opt("Morning"), opt("Afternoon"), opt("Evening")],
      }),
    ],
  },
];

export function findTemplate(id: string | null | undefined): FormTemplate {
  return FORM_TEMPLATES.find((t) => t.id === id) ?? FORM_TEMPLATES[0]!;
}

/** A public link's slug: lowercase letters and digits, hard to guess. */
export function newSlug(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}
