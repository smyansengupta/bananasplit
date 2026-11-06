// The enums entry, not the client: client components import this to hide
// the Delete button.
import type { DatabaseKind, Role } from "@/generated/prisma/enums";

import { can } from "@/lib/auth/permissions";

/**
 * Who may delete a database for good, the same rule as the DELETE policy on
 * "DatabaseDefinition" (20261103130000_database_delete), which enforces it
 * whatever the caller sends; this decides the message and whether the
 * button shows.
 *
 * Only an organization's own databases (kind CUSTOM) that no form writes
 * into. Owners and admins always; members too while the Admin panel's
 * "Members can delete databases" is on, for a database whose rows they can
 * edit.
 */
export interface DatabaseDeleteCheck {
  role: Role | null | undefined;
  kind: DatabaseKind;
  /** A form's answers land in it: deleting it would take the form along. */
  formOwned: boolean;
  /** OrgSettings.memberCanDeleteDatabases. */
  membersCanDelete: boolean;
  /** The viewer may add and edit its rows (app.can_edit_database). */
  canEditRows: boolean;
}

/** Why this database can never be deleted here, or null when it's one the organization made. */
export function deleteBlockedReason(
  check: Pick<DatabaseDeleteCheck, "kind" | "formOwned">,
): string | null {
  if (check.kind !== "CUSTOM") return "Built-in databases can't be deleted.";
  if (check.formOwned) return "This database holds a form's answers. Delete the form instead.";
  return null;
}

export function canDeleteDatabase(check: DatabaseDeleteCheck): boolean {
  if (!check.role || deleteBlockedReason(check)) return false;
  if (can({ role: check.role }, "databases.write")) return true;
  return check.membersCanDelete && check.canEditRows;
}

/** The confirm's words: what goes, and what a report reading it will show. */
export function deleteConfirmCopy(name: string, reports: number) {
  const base = "Its rows and fields are deleted for good. This can't be undone.";
  return {
    title: `Delete ${name}?`,
    description:
      reports > 0
        ? `${base} ${reports === 1 ? "A report reads" : `${reports} reports read`} it and will show it's gone.`
        : base,
    confirmLabel: "Delete database",
  };
}
