import type { MatchState } from "./types";

/**
 * Chart validation, shared by the draft editor's live checklist and the
 * publish action (which adds the current member ids). Pure.
 *
 * Errors block publishing: an empty chart, a missing title, a duplicate
 * key, a manager outside the version, a loop, an advisor with no manager or
 * with reports, an open hire with a linked member, and (server side) a
 * linked user who is no longer a member.
 * Warnings do not: several roots, unconfirmed suggestions and named people
 * who are not on the portal (both publish as placeholders).
 */

export interface ValidationNode {
  id: string;
  key: string;
  title: string;
  reportsTo: string | null;
  isAdvisor: boolean;
  isOpen: boolean;
  userId: string | null;
  personName: string | null;
  matchState: MatchState;
}

export type IssueCode =
  | "empty"
  | "no-title"
  | "duplicate-key"
  | "unknown-manager"
  | "cycle"
  | "advisor-no-manager"
  | "advisor-has-reports"
  | "advisor-of-advisor"
  | "open-with-member"
  | "not-a-member"
  | "multiple-roots"
  | "unconfirmed"
  | "placeholder";

export interface ValidationIssue {
  level: "error" | "warning";
  code: IssueCode;
  message: string;
  positionId?: string;
}

export interface ValidateOptions {
  /** Current member ids of the org (publish only). */
  memberIds?: ReadonlySet<string>;
}

export function validateChart(nodes: readonly ValidationNode[], options: ValidateOptions = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (code: IssueCode, message: string, positionId?: string) =>
    issues.push({ level: "error", code, message, positionId });
  const warning = (code: IssueCode, message: string, positionId?: string) =>
    issues.push({ level: "warning", code, message, positionId });

  if (nodes.length === 0) {
    error("empty", "Add at least one position.");
    return issues;
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const label = (n: ValidationNode) => n.title.trim() || "A position";

  const keys = new Map<string, string>();
  for (const n of nodes) {
    if (!n.title.trim()) error("no-title", "A position has no title.", n.id);
    const seen = keys.get(n.key);
    if (seen) error("duplicate-key", `${label(n)} has the same key as another position.`, n.id);
    else keys.set(n.key, n.id);
    if (n.reportsTo !== null && !byId.has(n.reportsTo)) {
      error("unknown-manager", `${label(n)} reports to a position that is not in this chart.`, n.id);
    }
    if (n.isOpen && n.userId) {
      error("open-with-member", `${label(n)} is an open hire but is linked to a member.`, n.id);
    }
    if (n.userId && options.memberIds && !options.memberIds.has(n.userId)) {
      error("not-a-member", `${label(n)} is linked to someone who is no longer a member.`, n.id);
    }
  }

  // Loops.
  const reported = new Set<string>();
  for (const start of nodes) {
    const seen = new Set<string>();
    let current: ValidationNode | undefined = start;
    while (current && current.reportsTo !== null) {
      if (seen.has(current.id)) {
        const cycleKey = [...seen].sort().join("|");
        if (!reported.has(cycleKey)) {
          reported.add(cycleKey);
          error("cycle", `The reporting lines form a loop through ${label(current)}.`, current.id);
        }
        break;
      }
      seen.add(current.id);
      current = byId.get(current.reportsTo);
    }
  }

  // Advisors.
  const reportsOf = new Map<string, ValidationNode[]>();
  for (const n of nodes) {
    if (n.reportsTo) reportsOf.set(n.reportsTo, [...(reportsOf.get(n.reportsTo) ?? []), n]);
  }
  for (const n of nodes) {
    if (!n.isAdvisor) continue;
    if (n.reportsTo === null) {
      error("advisor-no-manager", `${label(n)} is an advisor, so it needs someone it advises.`, n.id);
    } else if (byId.get(n.reportsTo)?.isAdvisor) {
      error("advisor-of-advisor", `${label(n)} advises another advisor.`, n.id);
    }
    if ((reportsOf.get(n.id) ?? []).length > 0) {
      error("advisor-has-reports", `${label(n)} is an advisor, so nobody can report to it.`, n.id);
    }
  }

  const roots = nodes.filter((n) => n.reportsTo === null && !n.isAdvisor);
  if (roots.length > 1) {
    warning(
      "multiple-roots",
      `${roots.length} positions report to nobody: ${roots.map(label).slice(0, 4).join(", ")}${roots.length > 4 ? ", …" : ""}.`,
    );
  }

  for (const n of nodes) {
    if (n.isOpen || n.userId) continue;
    if (n.matchState === "SUGGESTED") {
      warning("unconfirmed", `${label(n)}: confirm who ${n.personName ?? "this"} is, or it shows as a placeholder.`, n.id);
    } else if (n.personName) {
      warning("placeholder", `${label(n)}: ${n.personName} is not linked to a member and shows as a placeholder.`, n.id);
    }
  }

  return issues;
}

export function hasErrors(issues: readonly ValidationIssue[]): boolean {
  return issues.some((i) => i.level === "error");
}
