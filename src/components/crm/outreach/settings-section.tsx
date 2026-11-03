import { readOrgRouting } from "@/server/crm/outreach/intake";
import { withOrgTx } from "@/server/db/context";

import { OutreachSettings } from "./routing";

/** The CRM Settings page's outreach part (routing, the daily cap; only the cap in Personal); its own transaction. */
export async function OutreachSettingsSection({
  orgId,
  orgSlug,
  members,
  personal = false,
}: {
  orgId: string;
  orgSlug: string;
  members: { id: string; name: string }[];
  personal?: boolean;
}) {
  const data = await withOrgTx(orgId, async ({ db }) => ({
    routing: await readOrgRouting(db, orgId),
    cap: (await db.crmSettings.findUnique({ where: { organizationId: orgId }, select: { dailySendCap: true } }))?.dailySendCap ?? 150,
  }));
  return <OutreachSettings orgId={orgId} orgSlug={orgSlug} routing={data.routing} members={members} dailySendCap={data.cap} personal={personal} />;
}
