import { hasOptions, scaleRange, takesAnswer, type Question } from "@/lib/forms/questions";

/**
 * The Summary view: one tally per question, from the stored records' cell
 * values (the database's shapes, not the respondent's): option ids for a
 * choice, ids in order for checkboxes, true for yes, a number for ratings
 * and scales, and text for the rest.
 */

export type QuestionSummary =
  | {
      kind: "bars";
      question: Question;
      answered: number;
      bars: { id: string; label: string; count: number }[];
    }
  | {
      kind: "scale";
      question: Question;
      answered: number;
      average: number | null;
      bars: { id: string; label: string; count: number }[];
    }
  | { kind: "text"; question: Question; answered: number; samples: string[] };

const SAMPLES = 6;

export function summarize(
  questions: readonly Question[],
  records: readonly { values: Record<string, unknown> }[],
  /** The field's choices, which can grow past the form's options ("Other"). */
  choicesOf: (fieldId: string) => { id: string; label: string }[] = () => [],
): QuestionSummary[] {
  const out: QuestionSummary[] = [];
  for (const q of questions) {
    if (!takesAnswer(q.type) || q.type === "hidden" || !q.fieldId) continue;
    const cells = records
      .map((r) => r.values[q.fieldId!])
      .filter((v) => v !== undefined && v !== null && v !== "");
    if (hasOptions(q.type) && q.type !== "ranking") {
      const known = new Map((q.options ?? []).map((o) => [o.id, o.label]));
      for (const c of choicesOf(q.fieldId)) if (!known.has(c.id)) known.set(c.id, c.label);
      const counts = new Map<string, number>();
      for (const v of cells) {
        for (const id of Array.isArray(v) ? v : [v]) {
          if (typeof id === "string") counts.set(id, (counts.get(id) ?? 0) + 1);
        }
      }
      out.push({
        kind: "bars",
        question: q,
        answered: cells.length,
        bars: [...known].map(([id, label]) => ({ id, label, count: counts.get(id) ?? 0 })),
      });
    } else if (q.type === "yesno") {
      const yes = cells.filter((v) => v === true).length;
      out.push({
        kind: "bars",
        question: q,
        answered: records.length,
        bars: [
          { id: "yes", label: "Yes", count: yes },
          { id: "no", label: "No", count: records.length - yes },
        ],
      });
    } else if (q.type === "rating" || q.type === "scale") {
      const [lo, hi] = scaleRange(q);
      const nums = cells.filter((v): v is number => typeof v === "number");
      const bars = [];
      for (let n = lo; n <= hi; n++) {
        bars.push({ id: String(n), label: String(n), count: nums.filter((x) => x === n).length });
      }
      out.push({
        kind: "scale",
        question: q,
        answered: nums.length,
        average: nums.length
          ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10
          : null,
        bars,
      });
    } else {
      out.push({
        kind: "text",
        question: q,
        answered: cells.length,
        samples: cells
          .slice(-SAMPLES)
          .reverse()
          .map((v) => (Array.isArray(v) ? v.join(", ") : String(v))),
      });
    }
  }
  return out;
}
