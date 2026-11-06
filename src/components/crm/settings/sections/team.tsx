import { readOrgRouting } from "@/server/crm/outreach/intake";
import { withOrgTx } from "@/server/db/context";

import { SettingsMore } from "../settings-more";
import { AccessCard, ManagersCard, RoutingCard } from "../team-settings";
import { HandoverCards, preloadHandover } from "./handover";
import type { SectionProps } from "./types";

/**
 * Team (never in a Personal space, where the page doesn't offer it): who
 * sees what and who new people go to, for owners and admins; handing people
 * over, which CRM managers do too; and the CRM managers, under More.
 */
export async function TeamSection({ shell, orgSlug }: SectionProps) {
  const orgId = shell.org.id;
  if (!shell.access.admin) return <HandoverCards shell={shell} orgSlug={orgSlug} />;
  const dataP = withOrgTx(orgId, async ({ db }) => {
    const roles = await db.membership.findMany({
      where: { organizationId: orgId },
      select: { userId: true, role: true },
      take: 2000,
    });
    const owns = await db.crmPerson.groupBy({
      by: ["ownerId"],
      where: { organizationId: orgId, deletedAt: null, ownerId: { not: null } },
      _count: { _all: true },
    });
    return { roles, owns, routing: await readOrgRouting(db, orgId) };
  });
  preloadHandover(shell);
  const data = await dataP;
  const adminIds = new Set(
    data.roles.filter((r) => r.role === "OWNER" || r.role === "ADMIN").map((r) => r.userId),
  );
  const members = shell.members.map((m) => ({
    id: m.id,
    name: m.name,
    admin: adminIds.has(m.id),
    owns: data.owns.find((o) => o.ownerId === m.id)?._count._all ?? 0,
  }));
  return (
    <>
      <AccessCard orgId={orgId} initial={shell.access.settings?.memberAccess ?? "ALL"} />
      <RoutingCard
        orgId={orgId}
        initial={data.routing}
        members={shell.members}
        relationshipTypes={shell.access.settings?.relationshipTypes ?? []}
      />
      <HandoverCards shell={shell} orgSlug={orgSlug} />
      <SettingsMore>
        <ManagersCard
          orgId={orgId}
          members={members}
          initial={shell.access.settings?.managerIds ?? []}
          membersHref={`/app/${orgSlug}/settings/members`}
        />
      </SettingsMore>
    </>
  );
}
