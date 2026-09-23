import type { Prisma } from "@/generated/prisma/client";

/**
 * OrgAuditLog writer. The table has no INSERT grant for any runtime role:
 * rows arrive only through app.write_org_audit(), which fixes the id, the
 * actor (app.user_id()), the org (the caller's org) and createdAt, and bounds
 * the action and diff size (N5). Call it with the SAME transaction client as
 * the change it records, so the audit row commits or rolls back with it.
 *
 * `diff` is stored as-is: never put secrets, tokens or ciphertext in it
 * (last4 and provider names are fine).
 */

export type AuditDb = Pick<Prisma.TransactionClient, "$queryRaw">;

export interface OrgAuditEntry {
  organizationId: string;
  /** e.g. "integration.secret_set", "event.created". [A-Za-z][A-Za-z0-9_.:-]{0,79} */
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  diff?: Record<string, unknown>;
}

export async function writeOrgAuditLog(db: AuditDb, entry: OrgAuditEntry): Promise<string> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT app.write_org_audit(
      ${entry.organizationId}, ${entry.action}, ${entry.targetType ?? null}, ${entry.targetId ?? null},
      ${JSON.stringify(entry.diff ?? {})}::jsonb
    ) AS id`;
  return rows[0]?.id ?? "";
}
