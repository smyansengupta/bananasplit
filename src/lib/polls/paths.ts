/**
 * Where a poll lives in a space (`base` is /app/{slug}): a question under
 * Forms, a find-a-time poll under Find a time. /calendar/polls/{id} still
 * opens either (it forwards), so links made before either moved keep
 * working.
 */
export function pollHref(base: string, kind: "question" | "availability", id: string): string {
  return kind === "question" ? `${base}/forms/polls/${id}` : `${base}/calendar/find-a-time/${id}`;
}
