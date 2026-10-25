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
 * secrets, internal storage keys or internal copies of exported data:
 * ciphertext is never exported.
 */

export interface ExportTable {
  /** Prisma model name (also the file name). */
  model: string;
  /** Unique key, in keyset order. */
  key: readonly string[];
  omit?: readonly string[];
  /**
   * Rows the export leaves out, as a Prisma `where`. The export reads on the
   * service path, past the row policies, so anything the app shows only to
   * one person (a private note, a private file) is filtered here instead.
   */
  where?: Readonly<Record<string, unknown>>;
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
  { model: "Label", key: ID },
  { model: "Task", key: ID },
  { model: "TaskAssignee", key: ["taskId", "userId"] },
  { model: "TaskLabel", key: ["taskId", "labelId"] },
  { model: "TaskComment", key: ID },
  { model: "TaskMention", key: ID },
  { model: "TaskActivity", key: ID },
  { model: "WeeklyUpdate", key: ID },
  { model: "PulseIssue", key: ID },
  // yjsState: the live editor's binary copy of the body contentJson carries.
  // Shared with the club only: a private note or file is its author's alone,
  // owners included (the Note and OrgFile row policies), and stays so here.
  {
    model: "Note",
    key: ID,
    omit: ["yjsState"],
    where: { visibility: "ORGANIZATION", deletedAt: null },
  },
  {
    model: "OrgFile",
    key: ID,
    omit: ["storageKey"],
    where: { visibility: "ORGANIZATION", deletedAt: null },
  },
  { model: "NoteFolder", key: ID },
  // Comments on the club's notes only (as Note above); anchor is the live
  // editor's encoding of where a comment sits (anchorText quotes it).
  {
    model: "NoteComment",
    key: ID,
    omit: ["anchor"],
    where: { note: { visibility: "ORGANIZATION", deletedAt: null } },
  },
  { model: "Event", key: ID },
  { model: "EventAttendee", key: ["eventId", "userId"] },
  // RSVP page sign-ups; the export is OWNER-only, who see them in the suite too.
  { model: "EventRegistration", key: ID },
  // An RSVP page's bring list, and who is bringing each line.
  { model: "RsvpItem", key: ID },
  { model: "RsvpItemClaim", key: ["itemId", "registrationId"] },
  { model: "EventLinkLog", key: ID },
  { model: "AvailabilityPoll", key: ID },
  { model: "PollSlot", key: ID },
  { model: "PollResponse", key: ID, omit: ["guestKeyHash"] },
  { model: "Poll", key: ID },
  { model: "PollOption", key: ID },
  // Question-poll votes without who cast them, so an anonymous poll stays
  // anonymous in the export too (the counts per option are still there).
  { model: "PollVote", key: ID, omit: ["userId"] },
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
  // Club-made databases: the fields and every row, trash included (the
  // export is OWNER-only and reads past the visibility settings).
  { model: "DatabaseField", key: ID },
  { model: "DatabaseRecord", key: ID },
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
  Notification:
    "Each member's own inbox: personal, not club data, and only its recipient can read it.",
  OrgJoinCode:
    "The live invite code is a credential for joining the org; an export must not carry it.",
  Job: "Background job bookkeeping (ids and sanitized errors), not org data.",
  OrgSlugHistory:
    "Retired slugs; no runtime role can read the table (the manifest lists the current slug).",
  OrgDeletionLog: "Written only when an org is purged.",
  Pin: "Each member's own shortcuts; the service role cannot read them.",
  RecentVisit: "Each member's own browsing history in the app; private, and not org data.",
  MemberPrefs: "Each member's own display settings; the service role cannot read them.",
  ConnectorGrant:
    "Each member's own AI app connections (organizationId is only the space one is scoped to); the service role cannot read them.",
  NoteShare:
    "Who a note is shared with by name: mostly private notes, which the export leaves out, and access settings rather than club data.",
  NoteVersion:
    "Saved copies of note bodies (autosave snapshots and named versions); the export carries each club note's current body.",
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
