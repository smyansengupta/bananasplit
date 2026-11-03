import type { TxClient } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";

// Kept apart from the rest of the CRM so Events, RSVPs and Forms can call it
// without loading the CRM (it imports only the job queue).
export type RefreshSource =
  | { kind: "user"; id: string }
  | { kind: "contact"; id: string }
  | { kind: "registration"; id: string }
  | { kind: "response"; id: string };

/**
 * Something just happened in the workspace that lands on a CRM timeline (a
 * form answer, an RSVP, a check-in): queue a crm-refresh for whoever it
 * matches, right away instead of at the nightly run. The job resolves the
 * person on the service path (a member's view may not include them) and
 * mirrors just their timeline; a burst of changes merges into the one
 * pending job per source (the job's key). Never fails the caller: one
 * cheap read, then an enqueue, in the caller's transaction (member or
 * service), and only for organizations with the CRM set up.
 */
export async function queueCrmRefreshFor(db: TxClient, organizationId: string, source: RefreshSource): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(source.id)) return;
  // (A test double of the database may have no CRM at all.)
  const settings = (db as Partial<TxClient>).crmSettings;
  if (!settings) return;
  const crm = await settings.findUnique({ where: { organizationId }, select: { setupDoneAt: true } });
  if (!crm?.setupDoneAt) return;
  await enqueueJob(db, {
    orgId: organizationId,
    kind: "crm-refresh",
    key: `m:${source.kind}:${source.id}`,
    payload: { match: { [source.kind]: source.id } },
  });
}
