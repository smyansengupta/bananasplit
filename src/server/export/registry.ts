/**
 * The org export's table registry (Settings > Danger zone > Export).
 *
 * Every Prisma model with an organizationId is either exported here or
 * listed in EXPORT_EXCLUDED with the reason; registry.test.ts reads
 * prisma/schema.prisma and fails when a new org table is in neither list.
 *
 * Each table is read on the service path (withSystemOrgTx(orgId)) in keyset
 * pages ordered by `key`, and written as data/{Model}.ndjson plus
 * data/{Model}.csv. `omit` drops columns that are secrets, hashes of
 * secrets or internal storage keys: ciphertext is never exported.
 */

export interface ExportTable {
  /** Prisma model name (also the file name). */
  model: string;
  /** Unique key, in keyset order. */
  key: readonly string[];
  omit?: readonly string[];
  /**
   * Individual ballots: exported only when OrgSettings.ballotIndividualVisibility
   * lets an OWNER see them (not NOBODY), read with an explicit OWNER tier.
   */
  ballotRows?: boolean;
}

const ID = ["id"] as const;

export const EXPORT_TABLES: readonly ExportTable[] = [
  { model: "OrgSettings", key: ["organizationId"] },
  { model: "OrgTheme", key: ["organizationId"] },
  { model: "Membership", key: ID },
  { model: "OrgMemberHistory", key: ["organizationId", "userId"] },
  { model: "Invitation", key: ID, omit: ["token"] },
  { model: "OrgIntegration", key: ID, omit: ["secretFingerprint"] },
  { model: "OrgAuditLog", key: ID },
  { model: "OrgExport", key: ID, omit: ["blobKey", "cursor"] },
  { model: "Notification", key: ID },
  { model: "Project", key: ID },
  { model: "Label", key: ID },
  { model: "Task", key: ID },
  { model: "TaskAssignee", key: ["taskId", "userId"] },
  { model: "TaskLabel", key: ["taskId", "labelId"] },
  { model: "TaskComment", key: ID },
  { model: "TaskMention", key: ID },
  { model: "TaskActivity", key: ID },
  { model: "WeeklyUpdate", key: ID },
  { model: "Note", key: ID },
  { model: "Event", key: ID },
  { model: "EventAttendee", key: ["eventId", "userId"] },
  { model: "EventLinkLog", key: ID },
  { model: "AvailabilityPoll", key: ID },
  { model: "PollSlot", key: ID },
  { model: "PollResponse", key: ID, omit: ["guestKeyHash"] },
  { model: "BudgetPeriod", key: ID },
  { model: "BudgetCategory", key: ID },
  { model: "Transaction", key: ID },
  { model: "Receipt", key: ID, omit: ["blobKey"] },
  { model: "Sponsor", key: ID },
  { model: "Sponsorship", key: ID },
  { model: "FinanceAuditLog", key: ID },
  { model: "OrgChartVersion", key: ID, omit: ["sourceBlobKey"] },
  { model: "OrgChartPosition", key: ID },
  { model: "DatabaseDefinition", key: ID },
  { model: "Contact", key: ID },
  { model: "ContactEmail", key: ID },
  { model: "ContactTermStats", key: ["organizationId", "contactId", "term"] },
  { model: "Attendance", key: ID },
  { model: "Signup", key: ID },
  { model: "BallotDefinition", key: ID },
  { model: "Ballot", key: ID, ballotRows: true },
  { model: "BallotChoice", key: ID, ballotRows: true },
  { model: "DataSourceSyncState", key: ID },
];

/** Org tables that are deliberately not exported, and why. */
export const EXPORT_EXCLUDED: Readonly<Record<string, string>> = {
  OrgSecret: "Encrypted integration secrets: ciphertext is never exported.",
  Job: "Background job bookkeeping (ids and sanitized errors), not org data.",
  OrgSlugHistory:
    "Retired slugs; no runtime role can read the table (the manifest lists the current slug).",
  OrgDeletionLog: "Written only when an org is purged.",
};

/** The Prisma client property for a model name ("OrgChartPosition" -> "orgChartPosition"). */
export function delegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/**
 * The keyset filter for the page after `last`: rows whose key tuple sorts
 * after last's, e.g. for [a, b]: a > la OR (a = la AND b > lb).
 */
export function keysetAfter(
  key: readonly string[],
  last: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!last) return {};
  const or: Record<string, unknown>[] = [];
  for (let i = 0; i < key.length; i++) {
    const clause: Record<string, unknown> = {};
    for (let j = 0; j < i; j++) clause[key[j]] = last[key[j]];
    clause[key[i]] = { gt: last[key[i]] };
    or.push(clause);
  }
  return or.length === 1 ? or[0] : { OR: or };
}

export function keysetOrder(key: readonly string[]): Record<string, "asc">[] {
  return key.map((k) => ({ [k]: "asc" as const }));
}
