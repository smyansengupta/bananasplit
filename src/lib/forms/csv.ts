import type { Question } from "@/lib/forms/questions";

/** What turns a stored answer back into words: choice and member names. */
export interface AnswerNames {
  choices: Record<string, { id: string; label: string }[]>;
  members: Record<string, string>;
}

/**
 * An answer as plain text: choices by name, yes or no, a member's name,
 * ratings as "4 of 5". Uploads and links stay as their link. Blank when
 * there's no answer.
 */
export function answerText(q: Question, value: unknown, names: AnswerNames): string {
  if (value === undefined || value === null || value === "") return "";
  const label = (id: string) =>
    names.choices[q.fieldId ?? ""]?.find((c) => c.id === id)?.label ??
    q.options?.find((o) => o.id === id)?.label ??
    id;
  if (q.type === "yesno") return value === true ? "Yes" : "No";
  if (Array.isArray(value)) return value.map((v) => label(String(v))).join(", ");
  if (q.type === "choice" || q.type === "dropdown") return label(String(value));
  if (q.type === "member") return names.members[String(value)] ?? "Member";
  if (q.type === "rating") return `${String(value)} of ${q.max ?? 5}`;
  return String(value);
}

/** One CSV cell: quoted when it has to be, and never read as a formula. */
function cell(text: string): string {
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * The responses as a CSV: who, then each question that takes an answer,
 * then the review status when the form is reviewed, then when it was sent.
 */
export function responsesCsv(
  questions: readonly Question[],
  rows: readonly {
    who: string;
    email: string | null;
    status: string;
    createdAt: string;
    values: Record<string, unknown>;
  }[],
  names: AnswerNames,
  review: boolean,
): string {
  const asked = questions.filter((q) => q.fieldId && q.type !== "section");
  const head = [
    "Response",
    "Email",
    ...asked.map((q) => q.title || "Question"),
    ...(review ? ["Status"] : []),
    "Sent",
  ];
  const lines = rows.map((r) => [
    r.who,
    r.email ?? "",
    ...asked.map((q) => answerText(q, r.values[q.fieldId!], names)),
    ...(review ? [r.status.charAt(0) + r.status.slice(1).toLowerCase()] : []),
    r.createdAt,
  ]);
  return [head, ...lines].map((l) => l.map(cell).join(",")).join("\r\n");
}

/** "Jordan Park" → "JP"; one name gives its first two letters. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}
