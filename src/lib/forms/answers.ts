import { z } from "zod";

import {
  hasOptions,
  pathThrough,
  scaleRange,
  takesAnswer,
  type Question,
} from "@/lib/forms/questions";

/**
 * What a respondent sends, question by question, and the checks every
 * answer passes before it's stored (in the browser as they go, and again on
 * the server, which never trusts the browser's copy).
 *
 * Shapes, by question type:
 * - text-like (short, long, number, email, phone, date, link, hidden): a string
 * - choice, dropdown: an option id, or "other" with the text in `other`
 * - checkboxes: option ids (and "other")
 * - ranking: every option id, in the order they put them
 * - yes or no: true or false
 * - rating, scale: a whole number in range
 * - file, image: the id of the upload they sent (it's stored as a link)
 * - member: a user id in the organization
 */

export const OTHER = "other";

export const answerSchema = z.union([
  z.string().max(10_000),
  z.number(),
  z.boolean(),
  z.array(z.string().max(64)).max(60),
  z.null(),
]);
export type Answer = z.infer<typeof answerSchema>;

export const submissionSchema = z.object({
  answers: z.record(z.string().max(32), answerSchema),
  /** "Other" boxes' text, by question id. */
  other: z.record(z.string().max(32), z.string().max(200)).default({}),
});
export type Submission = z.infer<typeof submissionSchema>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Is the answer to `q` blank? */
export function isBlank(q: Question, value: Answer | undefined, other?: string): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") {
    if (value === OTHER) return !other?.trim();
    return value.trim() === "";
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return true;
    if (value.length === 1 && value[0] === OTHER) return !other?.trim();
    return false;
  }
  if (q.type === "yesno") return false;
  return false;
}

/** The problem with one answer, or null. Required-ness is the caller's. */
export function answerProblem(
  q: Question,
  value: Answer | undefined,
  other?: string,
): string | null {
  if (isBlank(q, value, other)) return null;
  const ids = new Set((q.options ?? []).map((o) => o.id));
  switch (q.type) {
    case "short":
    case "long":
    case "hidden":
      if (typeof value !== "string") return "Type an answer.";
      if (q.type !== "long" && value.length > 1000) return "Keep it under 1,000 characters.";
      return null;
    case "number":
      return typeof value === "number" ||
        (typeof value === "string" && Number.isFinite(Number(value)))
        ? null
        : "Enter a number.";
    case "email":
      return typeof value === "string" && EMAIL.test(value.trim())
        ? null
        : "Enter an email address.";
    case "phone":
      return typeof value === "string" && value.replace(/\D/g, "").length >= 7
        ? null
        : "Enter a phone number.";
    case "date":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? null : "Pick a date.";
    case "link":
      return typeof value === "string" && /^(https?:\/\/)?[^\s.]+\.[^\s]{2,}/i.test(value.trim())
        ? null
        : "Enter a link like example.com.";
    case "choice":
    case "dropdown":
      if (typeof value !== "string") return "Pick one.";
      if (value === OTHER) return q.allowOther ? null : "Pick one.";
      return ids.has(value) ? null : "Pick one of the choices.";
    case "checkboxes":
      if (!Array.isArray(value)) return "Pick any that fit.";
      return value.every((v) => ids.has(v) || (v === OTHER && q.allowOther))
        ? null
        : "Pick from the choices.";
    case "ranking":
      if (!Array.isArray(value)) return "Put them in order.";
      return value.length === ids.size && value.every((v) => ids.has(v))
        ? null
        : "Put every choice in order.";
    case "yesno":
      return typeof value === "boolean" ? null : "Yes or no.";
    case "rating":
    case "scale": {
      const [lo, hi] = scaleRange(q);
      return typeof value === "number" && Number.isInteger(value) && value >= lo && value <= hi
        ? null
        : `Pick ${lo} to ${hi}.`;
    }
    case "file":
    case "image":
    case "signature":
    case "member":
      return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? null : "Try again.";
    case "section":
      return null;
  }
}

/** The problem with the answer to `q` given whether it's on their path. */
export function checkOne(q: Question, value: Answer | undefined, other?: string): string | null {
  if (!takesAnswer(q.type)) return null;
  if (q.required && q.type !== "hidden" && isBlank(q, value, other)) {
    return hasOptions(q.type) || q.type === "yesno"
      ? "Pick one to keep going."
      : "Please fill this in.";
  }
  return answerProblem(q, value, other);
}

/**
 * Every problem in a submission, by question id: only questions on the
 * path the answers take count (a skipped question can't be required), and
 * answers to questions not on it are dropped by the caller.
 */
export function checkSubmission(
  questions: readonly Question[],
  submission: Submission,
): { path: Question[]; errors: Record<string, string> } {
  const path = pathThrough(questions, submission.answers);
  const errors: Record<string, string> = {};
  for (const q of path) {
    const problem = checkOne(q, submission.answers[q.id], submission.other[q.id]);
    if (problem) errors[q.id] = problem;
  }
  return { path, errors };
}
