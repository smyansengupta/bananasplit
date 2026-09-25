import { BookOpenText, Cpu, FileQuestion, LayoutTemplate, PencilLine } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { claudeModelLabel, formatUsd } from "@/lib/org-chart/models";
import type { ParseMethod, ParseReport, ParseShape } from "@/lib/org-chart/types";

/**
 * Where this draft came from and what was understood, shown above the
 * editor so an admin knows what to check. Nothing here changes the draft;
 * the rule that nothing publishes without a human review is unchanged.
 */

const SHAPE_LABEL: Record<ParseShape, string> = {
  sections: "a section per role, with its reporting line",
  table: "a table of roles",
  outline: "an indented outline",
  diagram: "a drawn chart",
  none: "no structure it recognized",
};

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export interface ParseReportPanelProps {
  method: ParseMethod | null;
  report: ParseReport | null;
  model: string | null;
  costUsd: number | null;
  /** The built-in confidence, which is also on the report when there is one. */
  confidence: number | null;
}

export function ParseReportPanel({ method, report, model, costUsd, confidence }: ParseReportPanelProps) {
  if (!method) return null;
  const score = report?.confidence ?? confidence;

  const heading = (() => {
    switch (method) {
      case "BUILTIN":
        return {
          icon: BookOpenText,
          title: "Read by the portal's own parser",
          detail: "No Claude API key was used and nothing was billed.",
        };
      case "CLAUDE":
        return {
          icon: Cpu,
          title: `Read by ${claudeModelLabel(model)}`,
          detail:
            "The portal's own parser could not read this document, so your organization's Claude key was used." +
            (costUsd !== null ? ` This import cost about ${formatUsd(costUsd)}.` : ""),
        };
      case "TEMPLATE":
        return {
          icon: LayoutTemplate,
          title: "Started from the club template",
          detail: "The common club roles are laid out for you. Fill in the people and edit anything that does not fit.",
        };
      case "MANUAL":
        return { icon: PencilLine, title: "Built by hand", detail: null };
    }
  })();
  const Icon = heading.icon;

  return (
    <section aria-label="How this draft was read" className="space-y-3 rounded-xl border p-3 text-sm">
      <div className="flex flex-wrap items-start gap-3">
        <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{heading.title}</p>
            {method === "BUILTIN" && score !== null && (
              <Badge variant={score >= 0.9 ? "secondary" : "outline"}>{percent(score)} understood</Badge>
            )}
          </div>
          {heading.detail && <p className="text-muted-foreground">{heading.detail}</p>}
          {report && report.positions > 0 && (
            <p className="text-muted-foreground">
              Found {report.positions} position{report.positions === 1 ? "" : "s"} written as{" "}
              {SHAPE_LABEL[report.shape]}: {report.identified} name a person or are marked open, {report.linked} report
              to another position, and {report.linesUsed} of {report.linesConsidered} lines were placed.
            </p>
          )}
        </div>
      </div>

      {report && report.notes.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-6">
          {report.notes.map((note, i) => (
            <li key={i}>{note}</li>
          ))}
        </ul>
      )}

      {report && report.orphanLines.length > 0 && (
        <details>
          <summary className="flex cursor-pointer items-center gap-1.5 font-medium">
            <FileQuestion className="size-4" aria-hidden="true" />
            {report.orphanCount} line{report.orphanCount === 1 ? "" : "s"} could not be placed under a position
          </summary>
          <p className="text-muted-foreground mt-1">
            Nothing was invented from these. If any of them belong to a role, add them to that position&apos;s
            responsibilities.
          </p>
          <ul className="text-muted-foreground mt-1 max-h-48 space-y-0.5 overflow-auto pl-1">
            {report.orphanLines.map((line, i) => (
              <li key={i} className="truncate font-mono text-xs" title={line}>
                {line}
              </li>
            ))}
          </ul>
          {report.orphanCount > report.orphanLines.length && (
            <p className="text-muted-foreground mt-1 text-xs">
              and {report.orphanCount - report.orphanLines.length} more.
            </p>
          )}
        </details>
      )}
    </section>
  );
}
