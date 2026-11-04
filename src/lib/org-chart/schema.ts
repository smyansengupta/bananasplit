import { z } from "zod";

/**
 * The strict JSON shape Claude returns for an org-chart document (decision
 * 'Org chart parsing with Claude'). It is the spec's schema plus three
 * fields: is_advisor (the spec's advisor rule, "no reports, reporting to one
 * person", matches every leaf, so advisors must be flagged explicitly),
 * source_quote (the lines the position was read from, shown in review) and
 * also_reports_to (dotted lines; defaults to none, so older parses and
 * fixtures still read).
 *
 * The schema is flat (structured outputs reject recursive schemas) and has
 * no length constraints: the SDK would strip them anyway, and normalize()
 * clamps every string and list deterministically afterwards.
 */

export const RawPositionSchema = z.object({
  id: z
    .string()
    .describe("A short id for this position, unique in this document, e.g. 'vp-growth'."),
  title: z.string().describe("The position's title exactly as the document names it."),
  person_name: z
    .string()
    .nullable()
    .describe("The full name of the person in the position, or null when the document names nobody."),
  reports_to: z
    .string()
    .nullable()
    .describe("The id of the position this one reports to, or null for the top of the chart."),
  also_reports_to: z
    .array(z.string())
    .default([])
    .describe(
      "Ids of other positions this one also reports to (a dotted line or second manager), besides reports_to. Usually empty.",
    ),
  manages: z
    .array(z.string())
    .describe("Ids of the positions this one manages, as the document states them."),
  responsibilities: z.array(z.string()).describe("One short bullet per responsibility."),
  decides_alone: z
    .array(z.string())
    .describe("Decisions this position makes without asking anyone (the document's 'decides alone')."),
  is_open: z.boolean().describe("True when the position is vacant or an open hire."),
  is_advisor: z
    .boolean()
    .describe("True only for an advisor who sits beside their manager and manages nobody."),
  source_quote: z
    .array(z.string())
    .describe("Short verbatim quotes from the document that this position was read from."),
});

export const RawOpenItemSchema = z.object({
  who: z.string().describe("Who should answer, as named in the document."),
  question: z.string().describe("The unresolved question or ambiguity."),
});

export const OrgChartParseSchema = z.object({
  positions: z.array(RawPositionSchema),
  open_items: z
    .array(RawOpenItemSchema)
    .describe("Questions the document leaves open, including anything ambiguous about the structure."),
});

// Input types, so a position may leave also_reports_to out (it defaults to []).
export type RawPosition = z.input<typeof RawPositionSchema>;
export type RawOpenItem = z.input<typeof RawOpenItemSchema>;
export type OrgChartParse = z.input<typeof OrgChartParseSchema>;
