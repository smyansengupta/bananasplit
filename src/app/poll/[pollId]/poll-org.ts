import { withSystemOrgTx } from "@/server/db/context";

const POLL_ID = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * The org that owns a poll, for the public /poll/[pollId] page and its
 * action: app.poll_org_id (SECURITY DEFINER, EXECUTE for app_service) on the
 * service path with no org context. The caller then opens
 * withSystemOrgTx(orgId), which sees only that org's rows.
 */
export async function pollOrgId(pollId: string): Promise<string | null> {
  if (!POLL_ID.test(pollId)) return null;
  return withSystemOrgTx(null, async ({ db }) => {
    const rows = await db.$queryRaw<{ id: string | null }[]>`SELECT app.poll_org_id(${pollId}) AS id`;
    return rows[0]?.id ?? null;
  });
}
