import type { RoleOwner } from "@/server/crm/owners";
import { followUpQueue, phoneProviderConnected } from "@/server/crm/outreach/queue";
import { composeTemplates, queueRows } from "@/server/crm/outreach/view";
import { withOrgTx } from "@/server/db/context";

import { FollowUpQueue } from "./queue";

/**
 * The follow-up queue on the CRM's home (docs/features/crm.md, module 5):
 * yours first, everyone's when asked or when nothing is yours. Reads in its
 * own transaction, so the home page only places it.
 */
export async function QueueSection({
  orgId,
  orgSlug,
  userId,
  roles,
  members,
  everyone,
}: {
  orgId: string;
  orgSlug: string;
  userId: string;
  roles: ReadonlyMap<string, RoleOwner>;
  members: readonly { id: string; name: string }[];
  everyone: boolean;
}) {
  const phone = await phoneProviderConnected(orgId).catch(() => false);
  const data = await withOrgTx(orgId, async ({ db }) => {
    let items = await followUpQueue(db, orgId, userId, roles, { mine: !everyone });
    const mine = !everyone && items.length > 0;
    if (!everyone && items.length === 0) items = await followUpQueue(db, orgId, userId, roles, { mine: false, limit: 25 });
    return { items, mine, templates: await composeTemplates(db, orgId) };
  });
  const names = new Map(members.map((m) => [m.id, m.name]));
  return (
    <FollowUpQueue
      orgId={orgId}
      orgSlug={orgSlug}
      rows={queueRows(data.items, names)}
      templates={data.templates}
      phone={phone}
      description={everyone ? "Everyone's." : data.mine ? "Yours: replies, steps, follow-ups, your campaign share." : "Nothing of yours, so everyone's."}
    />
  );
}
