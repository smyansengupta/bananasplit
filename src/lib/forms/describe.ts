import { QUESTION_META, takesAnswer, type Question } from "@/lib/forms/questions";

/**
 * A form's second line on the Forms home: how many questions, and what
 * kinds of uploads it takes ("Resume and photo uploads, 14 questions").
 */
export function describeQuestions(questions: readonly Question[]): string {
  const asked = questions.filter((q) => takesAnswer(q.type) && q.type !== "hidden");
  const count = `${asked.length} ${asked.length === 1 ? "question" : "questions"}`;
  const kinds = [
    asked.some((q) => q.type === "file") && "file",
    asked.some((q) => q.type === "image") && "photo",
    asked.some((q) => q.type === "signature") && "signature",
  ].filter(Boolean) as string[];
  if (kinds.length === 0) return count;
  const list =
    kinds.length === 1
      ? kinds[0]!
      : `${kinds.slice(0, -1).join(", ")} and ${kinds[kinds.length - 1]}`;
  const upload =
    `${list[0]!.toUpperCase()}${list.slice(1)} ${kinds.length === 1 && kinds[0] === "signature" ? "" : "uploads"}`.trim();
  return `${upload}, ${count}`;
}

/** The label of a question's type, for the builder's list ("File upload, PDF"). */
export function questionKind(q: Question): string {
  const label = QUESTION_META[q.type].label;
  if (q.type === "scale") return `Scale ${q.min ?? 1} to ${q.max ?? 10}`;
  if (q.type === "rating") return `Rating out of ${q.max ?? 5}`;
  return label;
}
