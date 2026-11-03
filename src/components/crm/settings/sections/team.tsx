import Link from "next/link";

import { SettingsCard } from "@/app/app/[orgSlug]/settings/settings-card";
import { Button } from "@/components/ui/button";
import { readOrgRouting } from "@/server/crm/outreach/intake";
import { withOrgTx } from "@/server/db/context";

import { AccessCard, ManagersCard, RoutingCard } from "../team-settings";
import type { SectionProps } from "./types";

/**
 * Team and access (owners and admins; never in a Personal space, where
 * the page doesn't offer it): who sees what, the CRM managers, who new
 * people go to, and handing someone's people over.
 */
export async function TeamSection({ shell, orgSlug }: SectionProps) {
  const orgId = shell.org.id;
  const data = await withOrgTx(orgId, async ({ db }) => {
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
    const unowned = await db.crmPerson.count({
      where: { organizationId: orgId, deletedAt: null, ownerId: null, ownerRoleKey: null },
    });
    return { roles, owns, unowned, routing: await readOrgRouting(db, orgId) };
  });
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
      <ManagersCard
        orgId={orgId}
        members={members}
        initial={shell.access.settings?.managerIds ?? []}
        membersHref={`/app/${orgSlug}/settings/members`}
      />
      <RoutingCard
        orgId={orgId}
        initial={data.routing}
        members={shell.members}
        relationshipTypes={shell.access.settings?.relationshipTypes ?? []}
      />
      <SettingsCard
        title="Handover"
        description="When someone steps back or leaves, give everyone they look after to someone else in one step."
        footer={
          <Button variant="outline" asChild>
            <Link href={`/app/${orgSlug}/crm/handover`}>Hand people over</Link>
          </Button>
        }
      >
        {data.unowned > 0 && (
          <p className="text-sm">
            {data.unowned.toLocaleString("en-US")}{" "}
            {data.unowned === 1 ? "person has" : "people have"} nobody looking after them.
          </p>
        )}
      </SettingsCard>
    </>
  );
}
