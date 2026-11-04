import type { TxClient } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";

const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** A burst (a note, then its edit, then a reply) merges into one pending job per person. */
const SETTLE_MS = 15_000;

/**
 * Something a person's biggest issue is read from just changed (a note,
 * a reply, a call): queue the crm-ai "issue" job for them. Kept apart from
 * the rest of the CRM so the inbox, the phone and the actions can call it
 * cheaply: one read, then an enqueue, in the caller's transaction. The job
 * itself asks the AI only when the content changed (src/lib/crm/issue.ts).
 */
export async function queueIssueRefresh(
  db: TxClient,
  organizationId: string,
  personIds: readonly string[],
  userId: string | null,
  /** At most one refresh per person an hour (mail coming in: anyone can send it). */
  options: { hourly?: boolean } = {},
): Promise<void> {
  const ids = [...new Set(personIds)].filter((id) => ID.test(id)).slice(0, 20);
  if (ids.length === 0) return;
  // (A test double of the database may have no CRM at all.)
  const settings = (db as Partial<TxClient>).crmSettings;
  if (!settings) return;
  const crm = await settings.findUnique({
    where: { organizationId },
    select: { setupDoneAt: true },
  });
  if (!crm?.setupDoneAt) return;
  const hour = Math.floor(Date.now() / 3_600_000).toString(36);
  for (const personId of ids) {
    await enqueueJob(db, {
      orgId: organizationId,
      kind: "crm-ai",
      // Hourly: one key per person per hour, and `once` refuses it after it ran.
      key: options.hourly ? `issue:${personId}:h${hour}` : `issue:${personId}`,
      payload: { action: "issue", personId, ...(userId && ID.test(userId) ? { userId } : {}) },
      runAt: new Date(Date.now() + SETTLE_MS),
      ...(options.hourly ? { once: true } : {}),
    });
  }
}
